const pg = require('pg');

const {
  POSTGRES_HOST,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_DATABASE,
  POSTGRES_URL,
} = process.env;

if(!POSTGRES_URL && !POSTGRES_HOST) {
  throw new Error('Missing environment variables for configuring connection to PostgreSQL database.  ' +
      'Please define either POSTGRES_URL or all of POSTGRES_HOST, POSTGRES_DATABASE, POSTGRES_USER, POSTGRES_PASSWORD');
}

if(POSTGRES_URL && POSTGRES_HOST) {
  throw new Error('Both POSTGRES_URL and POSTGRES_HOST environment variables are set - ' +
      'unclear which should be used to create the database pool.');
}

module.exports = new pg.Pool({
  host:     POSTGRES_HOST,
  user:     POSTGRES_USER,
  password: POSTGRES_PASSWORD,
  database: POSTGRES_DATABASE,
  connectionString: POSTGRES_URL,
});

