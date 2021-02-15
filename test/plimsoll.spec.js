const { assert } = require('chai');

const plimsoll = require('../src/plimsoll');

describe('plimsoll', () => {
  let pool;
  const dbQuery = async (sql, values) => {
    const client = await pool.connect();
    try {
    return client.query(sql, values);
    } finally {
      client.release();
    }
  };

  before(async () => {
    pool = require('./postgres-pool');
  });

  it('should exist', () => {
    // expect
    assert.isOk(plimsoll);
  });

  it('should add globalId, tableName, identity to Model', () => {
    // given
    const { models } = plimsoll(pool, { Thing:{ attributes:{} } }, {});

    // when
    const { Thing } = models;

    // then
    assert.equal(Thing.tableName, 'thing');

    // globalId is implied to be the model's filename with /.js$/ removed
    assert.equal(Thing.globalId,  'Thing');

    // Identity is:
    // > Case-insensitive, using filename to determine identity.
    // > - https://github.com/balderdashy/sails-hook-orm/blob/faeaa04065a323e7ae1186e703610a4f0baa4945/lib/load-models-and-custom-adapters.js#L33
    assert.equal(Thing.identity,  'thing');
  });

  describe('sendNativeQuery()', () => {
    let sendNativeQuery;

    before(async () => {
      sendNativeQuery = plimsoll(pool, {}).sendNativeQuery;
    });

    it('should allow running code in postgres', async () => {
      // when
      const { rows } = await sendNativeQuery('SELECT 2 + 5 AS my_sum');

      // then
      assert.deepEqual(rows, [ { my_sum:7 } ]);
    });
  });

  describe('Model-based queries', () => {
    let datastore;
    let Audited, Restricted, Simple, WithDefaults, WithRelationship;

    beforeEach(async () => {
      await dbQuery('DROP SCHEMA IF EXISTS public CASCADE');
      await dbQuery('CREATE SCHEMA public');

      await dbQuery(`CREATE TABLE Simple ( id SERIAL, name TEXT )`);

      await dbQuery(`CREATE TABLE Audited ( id SERIAL, name TEXT, created_at BIGINT, inserted_at BIGINT, updated_at BIGINT, _set_at BIGINT )`);

      await dbQuery(`CREATE TABLE WithDefaults ( id SERIAL, str_no_def TEXT, str_def TEXT, num_no_def INT, num_def INT )`);

      await dbQuery(`CREATE TABLE WithRelationship ( id SERIAL, name TEXT, my_simple INT )`);

      await dbQuery(`CREATE TABLE Restricted ( id SERIAL, category TEXT )`);

      datastore = plimsoll(pool, {
        Audited: {
          attributes: {
            id:          { type:'number', autoIncrement:true },
            name:        { type:'string' },
            created_at:  { type:'number', autoCreatedAt:true },
            inserted_at: { type:'number', autoCreatedAt:true },
            updated_at:  { type:'number', autoUpdatedAt:true },
            _set_at:     { type:'number', autoUpdatedAt:true },
          },
        },
        Restricted: {
          attributes: {
            id:       { type:'number', autoIncrement:true },
            category: { type:'string', isIn:['A', 'B', 'C'] },
          },
        },
        Simple: {
          attributes: {
            id:   { type:'number', autoIncrement:true },
            name: { type:'string' },
          },
        },
        WithDefaults: {
          attributes: {
            id:         { type:'number', autoIncrement:true },
            str_no_def: { type:'string' },
            str_def:    { type:'string', defaultsTo:'val' },
            num_no_def: { type:'number' },
            num_def:    { type:'number', defaultsTo:'77' },
          },
        },
        WithRelationship: {
          attributes: {
            id:        { type:'number', autoIncrement:true },
            name:      { type:'string' },
            my_simple: { model:'Simple' },
          },
        },
      });

      Audited          = datastore.models.Audited;
      Restricted       = datastore.models.Restricted;
      Simple           = datastore.models.Simple;
      WithDefaults     = datastore.models.WithDefaults;
      WithRelationship = datastore.models.WithRelationship;
    });

    describe('transaction()', () => {
      let checkpoints;
      beforeEach(() => {
        checkpoints = [];
      });

      function waitForCheckpoint(cp) {
        return new Promise((resolve, reject) => {
          const waitTimeout = Date.now() + 1000;
          function doCheck() {
            if(checkpoints.includes(cp)) resolve();
            else if(Date.now() > waitTimeout) reject(`timed out waiting for checkpoint: ${cp}`);
            else setTimeout(doCheck, 100);
          }
          doCheck();
        });
      }

      it('should obey transaction boundaries', async () => {
        const { sendNativeQuery, transaction } = datastore;

        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice')`);

        // when
        await Promise.all([
          transaction(async tx => {
            checkpoints.push('1a');
            const { rows } = await sendNativeQuery(`SELECT * FROM Simple WHERE id=1 FOR UPDATE`)
                .usingConnection(tx);
            checkpoints.push('1b');

            await waitForCheckpoint('2a'); // don't continue with update until we know the other tx is blocked

            const { name:oldName } = rows[0];
            const name = oldName + '-bob';

            return new Promise(resolve => {
              setTimeout(async () => {
                checkpoints.push('1c');
                await Simple.update(1)
                            .set({ name })
                            .usingConnection(tx)
                checkpoints.push('1d');
                resolve();
              }, 10);
            });
          }),
          transaction(async tx => {
            await waitForCheckpoint('1b'); // don't try to select the row until the other tx has definitely done so

            checkpoints.push('2a');
            const { rows } = await sendNativeQuery(`SELECT * FROM Simple WHERE id=1 FOR UPDATE`)
                .usingConnection(tx);
            checkpoints.push('2b');
            const { name:oldName } = rows[0];
            const name = oldName + '-charlie';

            return new Promise(resolve => {
              setTimeout(async () => {
                checkpoints.push('2c');
                await Simple.update(1)
                      .set({ name })
                      .usingConnection(tx)
                checkpoints.push('2d');
                resolve();
              }, 10);
            });
          }),
        ]);

        // then
        const person = await Simple.findOne(1);
        assert.equal(person.name, 'alice-bob-charlie');
        assert.deepEqual(checkpoints, [ '1a', '1b', '2a', '1c', '1d',
                                                    '2b', '2c', '2d' ]);
      });

      it('should rollback without affecting other transactions', async () => {
        const { sendNativeQuery, transaction } = datastore;

        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice')`);

        // when
        await Promise.all([
          (async () => {
            try {
              await transaction(async tx => {
                checkpoints.push('1a');
                const { rows } = await sendNativeQuery(`SELECT * FROM Simple WHERE id=1 FOR UPDATE`)
                    .usingConnection(tx);
                checkpoints.push('1b');

                await waitForCheckpoint('2a'); // don't continue with update until we know the other tx is blocked

                const { name:oldName } = rows[0];
                const name = oldName + '-bob';

                await new Promise(resolve => {
                  setTimeout(async () => {
                    checkpoints.push('1c');
                    await Simple.update(1)
                                .set({ name })
                                .usingConnection(tx)
                    checkpoints.push('1d');
                    resolve();
                  }, 10);
                });

                throw new Error('please rollback');
              });
            } catch(err) {
              if(err.message !== 'please rollback') {
                throw err;
              }
            }
          })(),
          transaction(async tx => {
            await waitForCheckpoint('1b'); // don't try to select the row until the other tx has definitely done so

            checkpoints.push('2a');
            const { rows } = await sendNativeQuery(`SELECT * FROM Simple WHERE id=1 FOR UPDATE`)
                .usingConnection(tx);
            checkpoints.push('2b');
            const { name:oldName } = rows[0];
            const name = oldName + '-charlie';

            return new Promise(resolve => {
              setTimeout(async () => {
                checkpoints.push('2c');
                await Simple.update(1)
                      .set({ name })
                      .usingConnection(tx)
                checkpoints.push('2d');
                resolve();
              }, 10);
            });
          }),
        ]);

        // then
        const person = await Simple.findOne(1);
        assert.equal(person.name, 'alice-charlie');
        assert.deepEqual(checkpoints, [ '1a', '1b', '2a', '1c', '1d',
                                                    '2b', '2c', '2d' ]);
      });
    });

    describe('find()', () => {
      it('should work without args', async () => {
        // expect
        assert.deepEqual(await Simple.find(), []);
      });

      it('should treat an empty object as SELECTing whole table', async () => {
        // expect
        assert.deepEqual(await Simple.find({}), []);
      });

      it('should return multiple rows', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

        // expect
        assert.deepEqual(await Simple.find(), [ { id:1, name:'alice' }, { id:2, name:'bob' } ]);
      });

      describe('with comparators in criteria', () => {
        it('should support !=', async () => {
          // given
          await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

          // expect
          assert.deepEqual(await Simple.find({ name:{ '!=':'alice' } }), [ { id:2, name:'bob' } ]);
        });

        it('should throw on unexpected comparators', async () => {
          try {
            // when
            await Simple.find({ name:{ '!?':'alice' } })
            assert.fail('should have thrown');
          } catch(e) {
            // then
            assert.equal(e.message, 'Unrecognised op in criteria: !?');
          }
        });
      });

      describe('with sort()', () => {
        beforeEach(async () => {
          // given
          await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('charlie'), ('bob')`);
        });

        describe('for full list', () => {
          it('should sort by id, ASC (by default)', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('id'), [ { id:1, name:'alice' }, { id:2, name:'charlie' }, { id:3, name:'bob' } ]);
          });

          it('should sort by id, ASC', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('id ASC'), [ { id:1, name:'alice' }, { id:2, name:'charlie' }, { id:3, name:'bob' } ]);
          });

          it('should sort by id, DESC', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('id DESC'), [ { id:3, name:'bob' }, { id:2, name:'charlie' }, { id:1, name:'alice' } ]);
          });

          it('should sort by name, ASC (by default)', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('name'), [ { id:1, name:'alice' }, { id:3, name:'bob' }, { id:2, name:'charlie' } ]);
          });

          it('should sort by name, ASC', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('name ASC'), [ { id:1, name:'alice' }, { id:3, name:'bob' }, { id:2, name:'charlie' } ]);
          });

          it('should sort by name, DESC', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('name DESC'), [ { id:2, name:'charlie' }, { id:3, name:'bob' }, { id:1, name:'alice' } ]);
          });

          it('should ignore extra spaces in the sort() string', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort(' name     DESC '), [ { id:2, name:'charlie' }, { id:3, name:'bob' }, { id:1, name:'alice' } ]);
          });

          it('should throw an error for a nonsensical direction', async () => {
            try {
              // when
              await Simple.find().sort('name FLAT');
              assert.fail('should have thrown');
            } catch(e) {
              // then
              assert.equal(e.message, 'Unexpected direction provided in ORDER BY clause: "FLAT"');
            }
          });
        });
      });

      describe('with limit()', () => {
        beforeEach(async () => {
          // given
          await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('charlie'), ('bob')`);
        });

        it('should return expected result for LIMIT 0', async () => {
          // expect
          assert.deepEqual(await Simple.find().limit(0), []);
        });

        it('should return expected result for LIMIT 1', async () => {
          // expect
          assert.deepEqual(await Simple.find().limit(1), [ { id:1, name:'alice' } ]);
        });

        it('should return expected result for LIMIT 2', async () => {
          // expect
          assert.deepEqual(await Simple.find().limit(2), [ { id:1, name:'alice' }, { id:2, name:'charlie' } ]);
        });

        it('should return expected result for LIMIT 3', async () => {
          // expect
          assert.deepEqual(await Simple.find().limit(3), [ { id:1, name:'alice' }, { id:2, name:'charlie' }, { id:3, name:'bob' } ]);
        });

        it('should work if limit is greater than rows returned', async () => {
          // expect
          assert.deepEqual(await Simple.find().limit(4), [ { id:1, name:'alice' }, { id:2, name:'charlie' }, { id:3, name:'bob' } ]);
        });

        it('should not work for an unsafely-large integer', async () => {
          try {
            // when
            await Simple.find().limit(Number.MAX_SAFE_INTEGER + 1);
            assert.fail('should have thrown');
          } catch(e) {
            // then
            assert.equal(e.message, 'Limit must be an integer.');
          }
        });
      });

      describe('with sort() and limit()', () => {
        beforeEach(async () => {
          // given
          await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('charlie'), ('bob')`);
        });

        describe('for full list', () => {
          it('should sort by id, ASC (by default)', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('id').limit(2), [ { id:1, name:'alice' }, { id:2, name:'charlie' } ]);
          });

          it('should sort by id, ASC', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('id ASC').limit(2), [ { id:1, name:'alice' }, { id:2, name:'charlie' } ]);
          });

          it('should sort by id, DESC', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('id DESC').limit(2), [ { id:3, name:'bob' }, { id:2, name:'charlie' } ]);
          });

          it('should sort by name, ASC (by default)', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('name').limit(2), [ { id:1, name:'alice' }, { id:3, name:'bob' } ]);
          });

          it('should sort by name, ASC', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('name ASC').limit(2), [ { id:1, name:'alice' }, { id:3, name:'bob' } ]);
          });

          it('should sort by name, DESC', async () => {
            // expect
            assert.deepEqual(await Simple.find().sort('name DESC').limit(2), [ { id:2, name:'charlie' }, { id:3, name:'bob' } ]);
          });
        });
      });

      it('should support model relationships without populate()', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);
        await dbQuery(`INSERT INTO WithRelationship (name, my_simple) VALUES ('alice_owner', 1), ('bob_owner', 2), ('owns_nothing', NULL)`);

        // expect
        assert.deepEqual(await Simple.find(), [ { id:1, name:'alice' }, { id:2, name:'bob' } ]);
        assert.deepEqual(await WithRelationship.find(),
            [
              { id:1, name:'alice_owner',  my_simple:1 },
              { id:2, name:'bob_owner',    my_simple:2 },
              { id:3, name:'owns_nothing', my_simple:null },
            ]);
      });

      it('should support model relationships with populate()', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);
        await dbQuery(`INSERT INTO WithRelationship (name, my_simple) VALUES ('alice_owner', 1), ('bob_owner', 2), ('owns_nothing', NULL)`);

        // expect
        assert.deepEqual(await Simple.find(), [ { id:1, name:'alice' }, { id:2, name:'bob' } ]);
        assert.deepEqual(await WithRelationship.find().populate('my_simple'),
            [
              { id:1, name:'alice_owner',  my_simple:{ id:1, name:'alice' } },
              { id:2, name:'bob_owner',    my_simple:{ id:2, name:'bob'   } },
              { id:3, name:'owns_nothing', my_simple:undefined },
            ]);
      });
    });

    describe('findOne()', () => {
      beforeEach(async () => {
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob'), ('bob')`);
      });

      it('should return undefined if no match', async () => {
        // expect
        assert.isUndefined(await Simple.findOne({ name:'charlie' }));
      });

      it('should return single match if there is one', async () => {
        // expect
        assert.deepEqual(await Simple.findOne({ name:'alice' }), { id:1, name:'alice' });
      });

      it('should throw if more than one match', async () => {
        // when
        try {
          await Simple.findOne();
          throw 'unexpected';
        } catch(err) {
          assert.equal(err.code, 21000) // "more than one row returned by a subquery used as an expression"
        }
      });

      it('should support model relationships without populate()', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);
        await dbQuery(`INSERT INTO WithRelationship (name, my_simple) VALUES ('alice_owner', 1), ('bob_owner', 2), ('owns_nothing', NULL)`);

        // expect
        assert.deepEqual(await WithRelationship.findOne(1), { id:1, name:'alice_owner',   my_simple:1 });
        assert.deepEqual(await WithRelationship.findOne(2), { id:2, name:'bob_owner',     my_simple:2 });
        assert.deepEqual(await WithRelationship.findOne(3), { id:3, name:'owns_nothing',  my_simple:null });
      });

      it('should support model relationships with populate()', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);
        await dbQuery(`INSERT INTO WithRelationship (name, my_simple) VALUES ('alice_owner', 1), ('bob_owner', 2), ('owns_nothing', NULL)`);

        // expect
        assert.deepEqual(await WithRelationship.findOne(1).populate('my_simple'), { id:1, name:'alice_owner',   my_simple:{ id:1, name:'alice' } });
        assert.deepEqual(await WithRelationship.findOne(2).populate('my_simple'), { id:2, name:'bob_owner',     my_simple:{ id:2, name:'bob'   } });
        assert.deepEqual(await WithRelationship.findOne(3).populate('my_simple'), { id:3, name:'owns_nothing',  my_simple:undefined });
      });
    });

    describe('create()', () => {
      describe('for a Simple entity', () => {
        it('should create an instance', async () => {
          // when
          await Simple.create({ name:'alice' });

          // then
          const { rows } = await dbQuery('SELECT * FROM Simple');
          assert.deepEqual(rows, [ { id:1, name:'alice' } ]);
        });

        it('should return instance if requested', async () => {
          // when
          const fetched = await Simple.create({ name:'alice' }).fetch();

          // then
          assert.deepEqual(fetched, { id:1, name:'alice' });
        });

        it('should support transactions', () => {
          // when
          const insert = Simple.create({ name:'alice' });

          // then
          assert.isFunction(insert.usingConnection);
        });
      });

      describe('for an Audited entity', () => {
        it('should set auto-timestamped rows', async () => {
          // when
          await Audited.create({ name:'alice' });

          // then
          const { rows } = await dbQuery('SELECT * FROM Audited');
          assert.equal(rows.length, 1);

          assert.deepInclude(rows[0], { id:1, name:'alice' });
          assertNumericFieldsEqual(rows[0], 'created_at', 'inserted_at', 'updated_at', '_set_at');
        });
      });

      describe('with global auto-created and auto-updated properties configured', () => {
        it('should set auto-timestamped rows', async () => {
          // given
          const { models } = plimsoll( pool, { Simple }, { created_timestamp:{ type:'number', autoCreatedAt:true } });
          Simple = models.Simple;

          await dbQuery('ALTER TABLE Simple ADD COLUMN created_timestamp BIGINT');

          // when
          await Simple.create({ name:'alice' });

          // then
          const { rows } = await dbQuery('SELECT * FROM Simple');
          assert.equal(rows.length, 1);
          assert.deepInclude(rows[0], { id:1, name:'alice' });
          assertNumericFieldsEqual(rows[0], 'created_timestamp');
        });
      });

      describe('for a restricted value', () => {
        it('should accept a valid value', async () => {
          await Restricted.create({ category:'A' });
        });

        it('should reject an invalid value', async () => {
          try {
            // when
            await Restricted.create({ category:'Z' });
            assert.fail('Should have thrown');
          } catch(err) {
            // then
            assert.equal(err.message, 'supplied value is not allowed'); // TODO make this error message more like the one from waterline(?), or at least include some detail
          }
        });
      });
    });

    describe('createEach()', () => {
      describe('for an empty list', () => {
        it('should not throw', async () => {
          // expect
          await Simple.createEach([]);
        });

        it('should return a thennable', async () => {
          // given
          const creator = Simple.createEach([]);

          // expect
          assert.isFunction(creator.then);
        });

        it('should allow transactions', async () => {
          // given
          const creator = Simple.createEach([]);

          // expect
          assert.isFunction(creator.usingConnection);
        });
      });

      describe('for a Simple entity', () => {
        it('should create multiple instances', async () => {
          // when
          await Simple.createEach([ { name:'alice' }, { name:'bob' } ]);

          // then
          const { rows } = await dbQuery('SELECT * FROM Simple');
          assert.equal(rows.length, 2);
          assert.deepEqual(rows, [ { id:1, name:'alice' }, { id:2, name:'bob' } ]);
        });
      });

      describe('for an Audited entity', () => {
        it('should set auto-timestamped rows', async () => {
          // when
          await Audited.createEach([ { name:'alice' }, { name:'bob' } ]);

          // then
          const { rows } = await dbQuery('SELECT * FROM Audited');
          assert.equal(rows.length, 2);

          assert.deepInclude(rows[0], { id:1, name:'alice' });
          assertNumericFieldsEqual(rows[0], 'created_at', 'inserted_at', 'updated_at', '_set_at');

          assert.deepInclude(rows[1], { id:2, name:'bob' });
          assertNumericFieldsEqual(rows[1], 'created_at', 'inserted_at', 'updated_at', '_set_at');

          // expect rows created in the same statement to have matching timestamps
          assert.equal(rows[0].created_at,
                       rows[1].created_at);
        });
      });
    });

    describe('update()', () => {
      describe('for an empty update object', () => {
        it('should not throw', async () => {
          // expect
          await Simple.update(-1).set({});
        });

        it('should be thennable', () => {
          // given
          const updater = Simple.update(-1).set({});

          // expect
          assert.isFunction(updater.then);
        });

        it('should allow transactions', () => {
          // given
          const updater = Simple.update(-1).set({});

          // expect
          assert.isFunction(updater.usingConnection);
        });

        it('should return matched values if requested', async () => {
          // given
          await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

          // when
          const matched = await Simple
              .update({ name:'alice' })
              .set({})
              .fetch();

          // then
          assert.deepEqual(matched, [ { id:1, name:'alice' } ]);
        });
      });

      it('should update a single row', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

        // when
        await Simple.update(1).set({ name:'charlie' });

        // then
        const { rows } = await dbQuery('SELECT * FROM Simple ORDER BY id');
        assert.deepEqual(rows, [ { id:1, name:'charlie' }, { id:2, name:'bob' } ]);
      });

      it('should update multiple rows', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

        // when
        await Simple.update({}).set({ name:'charlie' });

        // then
        const { rows } = await dbQuery('SELECT * FROM Simple ORDER BY id');
        assert.deepEqual(rows, [ { id:1, name:'charlie' }, { id:2, name:'charlie' } ]);
      });

      it('should update multiple rows for an array of IDs', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

        // when
        await Simple.update({ id:[1, 2 ] }).set({ name:'charlie' });

        // then
        const { rows } = await dbQuery('SELECT * FROM Simple ORDER BY id');
        assert.deepEqual(rows, [ { id:1, name:'charlie' }, { id:2, name:'charlie' } ]);
      });
    });

    describe('updateOne()', () => {
      describe('for an empty update object', () => {
        it('should not throw', async () => {
          // expect
          await Simple.updateOne(-1).set({});
        });

        it('should be thennable', () => {
          // given
          const updater = Simple.updateOne(-1).set({});

          // expect
          assert.isFunction(updater.then);
        });

        it('should allow transactions', () => {
          // given
          const updater = Simple.updateOne(-1).set({});

          // expect
          assert.isFunction(updater.usingConnection);
        });

        it('should always return matched value', async () => {
          // given
          await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

          // when
          const matched = await Simple
              .updateOne({ name:'alice' })
              .set({});

          // then
          assert.deepEqual(matched, { id:1, name:'alice' });
        });
      });

      it('should update a single row', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

        // when
        await Simple.updateOne(1).set({ name:'charlie' });

        // then
        const { rows } = await dbQuery('SELECT * FROM Simple ORDER BY id');
        assert.deepEqual(rows, [ { id:1, name:'charlie' }, { id:2, name:'bob' } ]);
      });

      it('should throw if multiple rows are matched', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

        // when
        try {
          await Simple.updateOne({}).set({ name:'charlie' });
          throw 'unexpected';
        } catch(err) {
          // then
          assert.equal(err.code, 21000);
        }
      });

      it('should not update undefined fields', async () => {
        // given
        await dbQuery(`INSERT INTO WithDefaults (str_no_def, str_def, num_no_def, num_def) VALUES ('a', 'b', 1, 2)`);

        // when
        await WithDefaults.updateOne(1).set({ str_no_def:'c' });

        // then
        const { rows } = await dbQuery('SELECT * FROM WithDefaults ORDER BY id');
        assert.deepEqual(rows, [ { id:1, str_no_def:'c', str_def:'b', num_no_def:1, num_def:2 } ]);
      });
    });

    describe('destroy()', () => {
      it('should work without args', async () => {
        // expect
        assert.deepEqual(await Simple.destroy(), []);
      });

      it('should treat an empty object as DELETing whole table', async () => {
        // expect
        assert.deepEqual(await Simple.destroy({}), []);
      });

      it('should DELETE multiple rows', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);

        // when
        await Simple.destroy();

        // then
        const { rows } = await dbQuery('SELECT * FROM Simple');
        assert.deepEqual(rows, []);
      });

      it('should not support select() chainging', async () => {
        // TODO it's actually quite reasonable to select fields when deleting,
        // and can be implemented using RETURNING
        try {
          // when
          assert.deepEqual(await Simple.destroy({ select:[ 'id' ] }));
          assert.fail('should have thrown');
        } catch(e) {
          // then
          assert.equal(e.message, 'Cannot understand use of select()/{ select } in a destroy() call.');
        }
      });
    });

    describe('destroyOne()', () => {
      beforeEach(async () => {
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob'), ('bob')`);
      });

      it('should have no effect if there is no match', async () => {
        // when
        await Simple.destroyOne({ name:'charlie' });

        // then
        const { rows } = await dbQuery('SELECT * FROM Simple');
        assert.equal(rows.length, 3);
        assert.deepEqual(rows, [ { id:1, name:'alice' }, { id:2, name:'bob' }, { id:3, name:'bob' } ]);
      });

      it('should delete the single match if there is one', async () => {
        // when
        await Simple.destroyOne({ name:'alice' });

        // then
        const { rows } = await dbQuery('SELECT * FROM Simple');
        assert.equal(rows.length, 2);
        assert.deepEqual(rows, [ { id:2, name:'bob' }, { id:3, name:'bob' } ]);
      });

      it('should throw if more than one match (no properties to match)', async () => {
        // when
        try {
          await Simple.destroyOne();
          throw 'unexpected';
        } catch(err) {
          assert.equal(err.code, 21000) // "more than one row returned by a subquery used as an expression"
        }
      });

      it('should throw if more than one match (matched properties)', async () => {
        // when
        try {
          await Simple.destroyOne({ name:'bob' });
          throw 'unexpected';
        } catch(err) {
          assert.equal(err.code, 21000) // "more than one row returned by a subquery used as an expression"
        }
      });
    });
  });

  describe('Model-based queries with schemaName provided in meta()', () => {
    const schemaName = 'my_schema';

    let Simple;

    beforeEach(async () => {
      await dbQuery('DROP SCHEMA IF EXISTS public    CASCADE');
      await dbQuery('DROP SCHEMA IF EXISTS my_schema CASCADE');
      await dbQuery('CREATE SCHEMA my_schema');
      await dbQuery(`CREATE TABLE  my_schema.Simple ( id SERIAL, name TEXT )`);
      await dbQuery(`INSERT INTO   my_schema.Simple (name) VALUES ('alice'), ('bob')`);

      const { models } = plimsoll(pool, {
        Simple: {
          attributes: {
            id:   { type:'number', autoIncrement:true },
            name: { type:'string' },
          },
        },
      });

      Simple = models.Simple;
    });

    it('should support find()', async () => {
      // expect
      assert.deepEqual(await Simple.find().meta({ schemaName }), [ { id:1, name:'alice' }, { id:2, name:'bob' } ]);
    });

    it('should support findOne()', async () => {
      // expect
      // TODO insert meta() call
      assert.deepEqual(await Simple.findOne({ name:'bob' }).meta({ schemaName }), { id:2, name:'bob' });
    });

    it('should support create()', async () => {
      // when
      // TODO insert meta() call
      await Simple
          .create({ name:'carol' })
          .meta({ schemaName });

      // then
      const { rows } = await dbQuery('SELECT * FROM my_schema.Simple');
      assert.deepEqual(rows, [ { id:1, name:'alice' }, { id:2, name:'bob' }, { id:3, name:'carol' } ]);
    });

    it('should support createEach()', async () => {
      // when
      await Simple
          .createEach([ { name:'carol' }, { name:'dave' } ])
          .meta({ schemaName });

      // then
      const { rows } = await dbQuery('SELECT * FROM my_schema.Simple');
      assert.equal(rows.length, 4);
      assert.deepEqual(rows, [ { id:1, name:'alice' }, { id:2, name:'bob' }, { id:3, name:'carol' }, { id:4, name:'dave' } ]);
    });

    it('should support createEach() when nothing is created', async () => {
      // when
      await Simple
          .createEach([])
          .meta({ schemaName });

      // then
      const { rows } = await dbQuery('SELECT * FROM my_schema.Simple');
      assert.equal(rows.length, 2);
      assert.deepEqual(rows, [ { id:1, name:'alice' }, { id:2, name:'bob' } ]);
    });

    it('should support update()', async () => {
      // when
      const matched = await Simple
          .update({ name:'alice' })
          .meta({ schemaName })
          .set({ name:'carol' })
          .fetch();

      // then
      assert.deepEqual(matched, [ { id:1, name:'carol' } ]);
    });

    it('should support updateOne()', async () => {
      // when
      const matched = await Simple
          .updateOne({ name:'alice' })
          .meta({ schemaName })
          .set({ name:'carol' })
          .fetch();

      // then
      assert.deepEqual(matched, { id:1, name:'carol' });
    });

  });

});

function assertNumericFieldsEqual(row, ...fieldNames) {
  const firstField = fieldNames[0];

  fieldNames
    .forEach(f => {
      const v = row[f];
      assert.equal(Number(v), v,       `Value for [${f}] is not numeric [${v}]`);
      assert.equal(v, row[firstField], `Value for [${f}] does not equal value for ${firstField}`);
    });
}
