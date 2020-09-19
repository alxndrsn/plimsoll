FROM node:lts-alpine

WORKDIR /work

ADD . /work/
RUN yarn install && yarn cache clean;

CMD ["echo", "bye"]
