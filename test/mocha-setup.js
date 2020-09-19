let pool;

before(() => {
  pool = require('./postgres-pool');
});

after(() => {
  pool.end();
});
