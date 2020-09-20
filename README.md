Plimsoll
========

![CI Test](https://github.com/alxndrsn/plimsoll/workflows/CI%20Test/badge.svg)
[![NPM](https://nodei.co/npm/plimsoll.png)](https://npmjs.org/package/plimsoll)

Lightweight ORM for using [PostgreSQL](https://www.postgresql.org/) with [Sails.js](https://sailsjs.com/).

This is an **experimental** drop-in replacement for all of the following [Sails.js](https://sailsjs.com/)/[`sails`](https://www.npmjs.com/package/sails) extensions:

* [`sails-hook-orm`](https://www.npmjs.com/package/sails-hook-orm)
* [`sails-postgresql`](https://www.npmjs.com/package/sails-postgresql)
* [`waterline`](https://www.npmjs.com/package/waterline)

This module has a peer dependency on [`pg`](https://www.npmjs.com/package/pg) ([`node-postgres`](https://node-postgres.com/)).


# Aims

* define minimal dependencies, and keep these up-to-date
* allow keeping [`pg`](https://www.npmjs.com/package/pg)/[`node-postgres`](https://node-postgres.com/) up-to-date in parent projects directly by defining it as a [peer dependency](https://nodejs.org/en/blog/npm/peer-dependencies/)
* simplicity
* work on [currently-supported PostgreSQL versions](https://www.postgresql.org/support/versioning/)
* don't support [sails's "migrations"](https://sailsjs.com/documentation/concepts/models-and-orm/model-settings#?migrate), i.e. automatic schema generation


# Installation

## Latest `master`

### With [Yarn](https://classic.yarnpkg.com/en/)

```sh
yarn remove sails-hook-orm sails-postgresql &&
yarn add pg https://github.com/alxndrsn/plimsoll.git#master
```

### With [`npm`](https://www.npmjs.com/)

```sh
npm uninstall sails-hook-orm sails-postgresql &&
npm install --save pg https://github.com/alxndrsn/plimsoll.git#master
```

## Latest Relase

### With [Yarn](https://classic.yarnpkg.com/en/)

```sh
yarn remove sails-hook-orm sails-postgresql &&
yarn add pg plimsoll
```

### With [`npm`](https://www.npmjs.com/)

```sh
npm uninstall sails-hook-orm sails-postgresql &&
npm install --save pg plimsoll
```


# Development

## Running tests

### With [Docker](https://www.docker.com/)

```sh
yarn test:docker
```

### Without Docker

This requires:

* a locally-accessible PostgreSQL server, with a user account
* environment variables defined for connecting to the DB

e.g.

```sh
POSTGRES_URL=postgresql://your_user:your_user_password@localhost:5432/plimsoll_test \
yarn test
```

or

```sh
POSTGRES_HOST=localhost \
POSTGRES_USER=your_user \
POSTGRES_PASSWORD=your_user_password \
POSTGRES_DATABASE=plimsoll_test \
yarn test
```

# Contributing

Any [bug reports, suggestions, or _general comments_ are welcome in the Issues](https://github.com/alxndrsn/plimsoll/issues/).

If you find a bug or gap in functionality, please report it.

It's especially helpful if you can provide a **failing test case**, or:

* model definition(s)
* db schema
* interaction performed
* observed result
* expected result
