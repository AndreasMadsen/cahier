/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var vows = require('vows'),
    path = require('path'),
    fs = require('fs'),
    async = require('async'),
    assert = require('assert'),
    common = require('../common.js'),
    cahier = require(common.cahier);

// remove temp content
common.reset();

var convert;
vows.describe('testing cahier when reading empty file').addBatch({

  'when a cahier object is created': {
    topic: function () {
      // create convert object
      async.series([

        // create cahier object
        function (callback) {
          convert = cahier(common.options, callback);
        },

        // setup cahier object
        function (callback) {

          convert.handle('json', 'string', function (content, next) {
            next( JSON.stringify({
              content: content
            }) );
          });

          callback(null);
        }
      ], this.callback);
    },

    'there shoud not be any errors': function (error, dum) {
      assert.ifError(error);
    }
  }

}).addBatch({

  'when requesting an empty file': {
    topic: function () {
      return common.handleStream( convert.read('/empty.json') );
    },

    'it should be read as any other file': function (error, content) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(content), {
        content: ''
      });
    }
  }

}).exportTo(module);
