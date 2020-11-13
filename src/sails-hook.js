const fs = require('fs');
const path = require('path');
const pg = require('pg');

const plimsoll = require('./plimsoll');

module.exports = function(sails) {
  const { config } = sails;

  const pool = getPoolFrom(config.datastores.default);

  const modelSources = {};

  fs.readdirSync(config.paths.models)
    .filter(f => f.endsWith('.js'))
    .forEach(f => {
      const modelName = f.replace(/\.js$/, '');
      modelSources[modelName] = require(path.join(config.paths.models, f));
    });

  const { models, sendNativeQuery, transaction } = plimsoll(pool, modelSources, config.models.attributes);

  const sailsModels = {};
  Object
    .entries(models)
    .forEach(([ name, model ]) => {
      const sailsName = name.toLowerCase();
      if(sailsModels[sailsName]) throw new Error(`Model name collision: ${sailsName}`);
      sailsModels[sailsName] = model;
    });

  sails.models = sailsModels;
  sails.sendNativeQuery = sendNativeQuery;

  if(config.globals.models) {
    Object.values(models)
      .forEach(model => {
        global[model.globalId] = model;
      });
  }

  sails.getDatastore = () => {
    return { manager:{ pool }, sendNativeQuery, transaction };
  };

  return {};
};

function getPoolFrom({ pool, url, ...poolConfig }) {
  if(pool) return pool;

  return new pg.Pool({ connectionString:url, ...poolConfig });
}
