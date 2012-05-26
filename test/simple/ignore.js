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

function matchError(error, filename) {
  var filepath = path.resolve(common.options.source, filename);

  var expect = {
    message: "ENOENT, open '" + filepath + "'",
    errno: 34,
    code: 'ENOENT',
    path: filepath
  };

  var actually = {
    message: error.message,
    errno: error.errno,
    code: error.code,
    path: error.path
  };

  assert.deepEqual(actually, expect);
}

var convert;
vows.describe('testing leaflet ignore').addBatch({

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

          convert.handle('json', 'string', function (content, next) {
            var obj = JSON.parse(content);
                obj.modified = true;

            next( JSON.stringify(obj) );
          });

          convert.ignore('relative.json');
          convert.ignore('/subdir/absolute.json');

          callback(null);
        }
      ], this.callback);
    },

    'there shoud not be any errors': function (error, dum) {
      assert.ifError(error);
    }
  }

}).addBatch({

  'when requesting an relative ignore file': {

    'in a root directory': {
      topic: function () {
        return common.handleStream( convert.read('/relative.json') );
      },

      'it should not exist': function (error, content) {
        matchError(error, './relative.json');
      }
    },

    'in a sub directory': {
      topic: function () {
        return common.handleStream( convert.read('/subdir/relative.json') );
      },

      'it should not exist': function (error, content) {
        matchError(error, './subdir/relative.json');
      }
    }
  },

  'when requesting an absolute ignore file': {

    'in a root directory': {
      topic: function () {
        return common.handleStream( convert.read('/absolute.json') );
      },

      'it should exist': function (error, content) {
        assert.isNull(error);
        assert.deepEqual(JSON.parse(content), {
          content: true,
          modified: true
        });
      }
    },

    'in a sub directory': {
      topic: function () {
        return common.handleStream( convert.read('/subdir/absolute.json') );
      },

      'it should not exist': function (error, content) {
        matchError(error, './subdir/absolute.json');
      }
    }
  },


  'when requesting a missing file': {
    topic: function () {
      return common.handleStream( convert.read('/missing.json') );
    },

    'it should not exist': function (error, content) {
      matchError(error, './missing.json');
    }
  }

}).exportTo(module);
