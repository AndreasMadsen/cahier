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
vows.describe('testing cahier converter - create directory').addBatch({

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
            var obj = JSON.parse(content);
                obj.first = 'first';

            next( JSON.stringify(obj) );
          });

          convert.handle('json', 'string', function (content, next) {
            var obj = JSON.parse(content);
                obj.second = 'second';

            next( JSON.stringify(obj) );
          });

          convert.convert('js', 'json');

          callback(null);
        }
      ], this.callback);
    },

    'no errors should be returned': function (error, dum) {
      assert.ifError(error);
    }
  }

}).addBatch({

  'when reading a file for first time': {
    topic: function () {
      return common.handleStream( convert.read('/subdir/static.json') );
    },

    'the content should be parsed by handlers': function (error, content) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(content), {
        zero: 'zero',
        position: 'root',
        first: 'first',
        second: 'second'
      });
    },

    'the stat file': {
      topic: function () {
        var self = this;

        setTimeout(function () {
          async.parallel({
            'origin': fs.stat.bind(fs, path.resolve(common.options.source, 'subdir/static.json')),
            'compiled': fs.stat.bind(fs, path.resolve(common.options.cache, 'subdir/static.json')),
            'cache': fs.readFile.bind(fs, common.options.state, 'utf8')
          }, self.callback);
        }, 200);
      },

      'should be updated': function (error, result) {
        assert.deepEqual({
          mtime: result.origin.mtime.getTime(),
          size: result.origin.size,
          compiled: result.compiled.size
        }, JSON.parse(result.cache)['subdir/static.json']);
      }
    },

    'the chached file': {
      topic: function () {
        fs.readFile(path.resolve(common.options.cache, 'subdir/static.json'), 'utf8', this.callback);
      },

      'should be created': function (error, content) {
        assert.ifError(error);

        assert.deepEqual(JSON.parse(content), {
          zero: 'zero',
          position: 'root',
          first: 'first',
          second: 'second'
        });
      }
    }
  }

}).exportTo(module);
