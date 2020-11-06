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
    let Audited, Simple, WithDefaults, WithRelationships;

    beforeEach(async () => {
      await dbQuery('DROP TABLE IF EXISTS Simple');
      await dbQuery(`CREATE TABLE Simple ( id SERIAL, name TEXT )`);

      await dbQuery('DROP TABLE IF EXISTS Audited');
      await dbQuery(`CREATE TABLE Audited ( id SERIAL, name TEXT, created_at BIGINT, inserted_at BIGINT, updated_at BIGINT, _set_at BIGINT )`);

      await dbQuery('DROP TABLE IF EXISTS WithDefaults');
      await dbQuery(`CREATE TABLE WithDefaults ( id SERIAL, str_no_def TEXT, str_def TEXT, num_no_def INT, num_def INT )`);

      await dbQuery('DROP TABLE IF EXISTS WithRelationships');
      await dbQuery(`CREATE TABLE WithRelationships ( id SERIAL, name TEXT, my_simple INT, my_with_defaults INT )`);

      const { models } = plimsoll(pool, {
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
        WithRelationships: {
          attributes: {
            id:               { type:'number', autoIncrement:true },
            name:             { type:'string' },
            my_simple:        { model:'Simple' },
            my_with_defaults: { model:'WithDefaults' },
          },
        },
      });

      Audited           = models.Audited;
      Simple            = models.Simple;
      WithDefaults      = models.WithDefaults;
      WithRelationships = models.WithRelationships;
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

      it('should support model relationships without populate()', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);
        await dbQuery(`INSERT INTO WithRelationships (name, my_simple) VALUES
                                                     ('alice_owner',  1),
                                                     ('bob_owner',    2),
                                                     ('owns_nothing', NULL)`);

        // expect
        assert.deepEqual(await WithRelationships.find(),
            [
              { id:1, name:'alice_owner',  my_simple:1,    my_with_defaults:null },
              { id:2, name:'bob_owner',    my_simple:2,    my_with_defaults:null },
              { id:3, name:'owns_nothing', my_simple:null, my_with_defaults:null },
            ]);
      });

      it('should support model relationships with populate()', async () => {
        // given
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob')`);
        await dbQuery(`INSERT INTO WithRelationships (name, my_simple) VALUES
                                                     ('alice_owner',  1),
                                                     ('bob_owner',    2),
                                                     ('owns_nothing', NULL)`);

        // expect
        assert.deepEqual(await WithRelationships.find().populate('my_simple'),
            [
              { id:1, name:'alice_owner',  my_simple:{ id:1, name:'alice' }, my_with_defaults:null },
              { id:2, name:'bob_owner',    my_simple:{ id:2, name:'bob'   }, my_with_defaults:null },
              { id:3, name:'owns_nothing', my_simple:null,                   my_with_defaults:null },
            ]);
      });

      it('should support model relationships with populate() with default values', async () => {
        // given
        await dbQuery(`INSERT INTO WithDefaults (str_no_def, str_def, num_no_def, num_def) VALUES
                                                (NULL, 'a',   NULL, 11),
                                                ('bob', NULL, 22,   NULL)`);
        await dbQuery(`INSERT INTO WithRelationships (name, my_simple, my_with_defaults) VALUES
                                                     ('def_owner',    NULL, 1),
                                                     ('no_def_owner', NULL, 2),
                                                     ('owns_nothing', NULL, NULL)`);

        // expect
        assert.deepEqual(await WithRelationships.find().populate('my_with_defaults'),
            [
              { id:1, name:'def_owner',    my_simple:null, my_with_defaults:{ id:1, str_no_def:'',    str_def:'a',   num_no_def: 0, num_def:11 } },
              { id:2, name:'no_def_owner', my_simple:null, my_with_defaults:{ id:2, str_no_def:'bob', str_def:'val', num_no_def:22, num_def:77 } },
              { id:3, name:'owns_nothing', my_simple:null, my_with_defaults:null },
            ]);
      });
    });

    describe('findOne()', () => {
      beforeEach(async () => {
        await dbQuery(`INSERT INTO Simple (name) VALUES ('alice'), ('bob'), ('bob'), (NULL)`);
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
        await dbQuery(`INSERT INTO WithRelationships (name, my_simple) VALUES
                                                     ('bob_owner',    2),
                                                     ('alice_owner',  1),
                                                     ('owns_nothing', NULL)`);

        // expect
        assert.deepEqual(await WithRelationships.findOne(1), { id:1, name:'bob_owner',     my_simple:2,    my_with_defaults:null });
        assert.deepEqual(await WithRelationships.findOne(2), { id:2, name:'alice_owner',   my_simple:1,    my_with_defaults:null });
        assert.deepEqual(await WithRelationships.findOne(3), { id:3, name:'owns_nothing',  my_simple:null, my_with_defaults:null });
      });

      it('should support model relationships with populate()', async () => {
        // given
        await dbQuery(`INSERT INTO WithRelationships (name, my_simple) VALUES
                                                     ('bob_owner',    2),
                                                     ('alice_owner',  1),
                                                     ('owns_nothing', NULL)`);

        // expect
        assert.deepEqual(await WithRelationships.findOne(1).populate('my_simple'),
            { id:1, name:'bob_owner',     my_simple:{ id:2, name:'bob'   }, my_with_defaults:null });
        assert.deepEqual(await WithRelationships.findOne(2).populate('my_simple'),
            { id:2, name:'alice_owner',   my_simple:{ id:1, name:'alice' }, my_with_defaults:null });
        assert.deepEqual(await WithRelationships.findOne(3).populate('my_simple'),
            { id:3, name:'owns_nothing',  my_simple:null,                   my_with_defaults:null });
      });

      it('should support model relationships with populate() with default values', async () => {
        // given
        await dbQuery(`INSERT INTO WithDefaults (str_no_def, str_def, num_no_def, num_def) VALUES
                                                (NULL, 'a',   NULL, 11),
                                                ('bob', NULL, 22,   NULL)`);
        await dbQuery(`INSERT INTO WithRelationships (name, my_simple, my_with_defaults) VALUES
                                                     ('def_owner',    NULL, 1),
                                                     ('no_def_owner', NULL, 2),
                                                     ('owns_nothing', NULL, NULL)`);

        // expect
        assert.deepEqual(await WithRelationships.findOne(1).populate('my_with_defaults'),
              { id:1, name:'def_owner',    my_simple:null, my_with_defaults:{ id:1, str_no_def:'',    str_def:'a',   num_no_def: 0, num_def:11 } });
        assert.deepEqual(await WithRelationships.findOne(2).populate('my_with_defaults'),
              { id:2, name:'no_def_owner', my_simple:null, my_with_defaults:{ id:2, str_no_def:'bob', str_def:'val', num_no_def:22, num_def:77 } });
        assert.deepEqual(await WithRelationships.findOne(3).populate('my_with_defaults'),
              { id:3, name:'owns_nothing', my_simple:null, my_with_defaults:null });
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
