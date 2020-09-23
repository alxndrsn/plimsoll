const _ = require('lodash');
const { assert } = require('chai');

const sailsHook = require('../src/sails-hook');

describe('sails-hook', () => {
  // given
  const pool = {};
  const sails = {
    config: {
      datastores: {
        default: { pool },
      },
      globals: { models:true },
      models: {},
      paths: {
        models: `${__dirname}/test-models`,
      },
    },
  };

  before(() => {
    // when
    sailsHook(sails);
  });
  after(() => {
    Object.keys(sails.models)
      .forEach(modelName => {
        delete global[modelName];
      });
  });

  it('should add configured models to sails', () => {
    assert.equal(sails.models.Thing.load_proof, 'random-313');
    assert.equal(sails.models.Thing.globalId,   'Thing');
    assert.equal(sails.models.Thing.tableName,  'thing');
  });

  it('should add models to global scope', () => {
    Object.entries(sails.models)
      .forEach(([ name, model ]) => {
        assert.equal(global[name], model);
      });
  });

  it('should expose sails.sendNativeQuery()', () => {
    assert.isFunction(sails.sendNativeQuery);
  });

  it('should expose sails.getDatastore()', () => {
    assert.isFunction(sails.getDatastore);
  });

  describe('sails.getDatastore()', () => {
    let datastore;
    before(() => {
      datastore = sails.getDatastore();
    });

    it('should expose manager.pool', () => {
      assert.equal(datastore.manager.pool, pool);
    });

    it('should have sendNativeQuery()', () => {
      assert.isFunction(datastore.sendNativeQuery);
      assert.equal(datastore.sendNativeQuery, sails.sendNativeQuery);
    });

    it('should define transaction()', () => {
      assert.isFunction(datastore.transaction);
    });
  });

  it('should allow config with sails.config.datastores.default.url', () => {
    // given
    const cloned = _.cloneDeep(sails);
    delete cloned.config.datastores.default.pool;
    cloned.config.datastores.default.url = 'postgres://example';

    // when
    sailsHook(cloned);

    // then
    assert.isOk(cloned.getDatastore().manager.pool);
  });

  describe('.attributes', () => {
    it('should move isIn to .validations sub property', () => {
      assert.isUndefined(sails.models.Thing.attributes.category.isIn);
      assert.deepEqual(  sails.models.Thing.attributes.category.validations.isIn, [ 'A', 'B', 'C' ]);
    });
  });
});
