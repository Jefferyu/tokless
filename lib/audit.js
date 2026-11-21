'use strict';

const analyzer = require('../tools/agy-audit/lib/analyzer');
const compare = require('../tools/agy-audit/lib/compare');
const project = require('../tools/agy-audit/lib/project');
const formatter = require('../tools/agy-audit/lib/formatter');
const paths = require('../tools/agy-audit/lib/paths');

module.exports = {
  ...paths,
  ...analyzer,
  ...compare,
  ...project,
  ...formatter,
};
