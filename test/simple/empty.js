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
    leaflet = require(common.leaflet);

// remove temp content
common.reset();

var convert;
vows.describe('testing leaflet converter').addBatch({

  'when a leaflet object is created': {
    topic: function () {
      // create convert object
      async.series([

        // create leaflet object
        function (callback) {
          convert = leaflet(common.options, callback);
        },

        // setup leaflet object
        function (callback) {

          convert.handle('json', function (content, next) {
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
      convert.read('/empty.json', this.callback);
    },

    'it should be read as any other file': function (error, content) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(content), {
        content: ''
      });
    }
  }

}).exportTo(module);
