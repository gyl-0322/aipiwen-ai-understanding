'use strict';

const { handler } = require('../server/v3a-sms-hook');

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false
  }
};
