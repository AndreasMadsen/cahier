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
vows.describe('testing cahier converter').addBatch({

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
          // simpel handlers, will add first and second exports properties
          convert.handle('json', 'string', function (content, next) {
            var obj = {};

            if (content !== '') {
              obj = JSON.parse(content);
              obj.first = 'first';
            }

            next( JSON.stringify(obj) );
          });

          convert.compile(callback);
        }
      ], this.callback);
    },

    'no errors should be returned': function (error, dum) {
      assert.ifError(error);
    }
  }

}).addBatch({

  'when reading a file': {
    topic: function () {
      var self = this;

      // read cache file
      fs.readFile(path.resolve(common.options.cache, 'static.json'), 'utf8', function (error, content) {
        if (error) self.callback(error, null);

        var obj = JSON.parse(content);
            obj.manipulated = true;

        var expected = JSON.stringify(obj);

        // overwrite cache file
        fs.writeFile(path.resolve(common.options.cache, 'static.json'), expected, function (error) {
          if (error) return self.callback(error);

          common.handleStream(convert.read('/static.json'), function (error, result) {
            self.callback(error, result, expected);
          });
        });
      });
    },

    'the content should be read from cache': function (error, result, expected) {
      assert.ifError(error);

      assert.equal(result, expected);
    }
  }

}).exportTo(module);
