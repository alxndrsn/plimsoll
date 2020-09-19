const { assert } = require('chai');

const sailsHook = require('../src/sails-hook');

describe('sails-hook-entry', () => {
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
        models: `${__dirname}/test-models/1`,
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
});
