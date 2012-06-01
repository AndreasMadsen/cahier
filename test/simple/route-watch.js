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
vows.describe('testing leaflet watcher').addBatch({

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

          callback(null);
        },

        // start wacher
        function (callback) {
          convert.watch();
          callback();
        }
      ], this.callback);
    },

    'check that the cache directory was created': function (error, dum) {
      assert.ifError(error);

      assert.isTrue(common.existsSync(common.options.cache));
    },

    'check that the state file was created': function (error, dum) {
      assert.ifError(error);

      assert.isTrue(common.existsSync(common.options.state));
    }
  }

}).addBatch({

  'when reading a file for first time': {
    topic: function () {
      return common.handleStream( convert.read('/change.json') );
    },

    'the content should be parsed by handlers': function (error, content) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(content), {
        first: 'first',
        second: 'second',
        state: 1
      });
    },

    'the mtime info property': {
      topic: function (content, stream) {
        async.parallel({
          'origin': fs.stat.bind(fs, path.resolve(common.options.source, 'change.json')),
          'stream': function (callback) {
            callback(null, stream);
          }
        }, this.callback);
      },

      'should match origin file stat': function (error, result) {
        assert.ifError(error);

        assert.equal(result.origin.mtime.getTime(), result.stream.mtime.getTime());
      }
    },

    'the chached file': {
      topic: function () {
        fs.readFile(path.resolve(common.options.cache, 'change.json'), 'utf8', this.callback);
      },

      'should be created': function (error, content) {
        assert.ifError(error);

        assert.deepEqual(JSON.parse(content), {
          first: 'first',
          second: 'second',
          state: 1
        });
      }
    }
  }

}).addBatch({

  'when the source file is modified': {
    topic: function () {
      // we will need to wait some time so fs.Stat.mtime won't be the same
      // PS: it is an unlikly edgecase that the source will be modified twise in the same second
      async.series({
        expected: function (callback) {
          // we will need to wait some time so fs.Stat.mtime won't be the same
          // PS: it is an unlikly edgecase that the source will be modified twise in the same seco
          setTimeout(function () {
            common.modify(callback);
          }, 1200);
        },
        content: function (callback) {
          common.handleStream(convert.read('/change.json'), callback);
        }
      }, this.callback);
    },

   'the content should be parsed by handlers': function (error, result) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(result.content[0]), {
        first: 'first',
        second: 'second',
        state: result.expected
      });
    },

    'the mtime info property': {
      topic: function (result) {
        async.parallel({
          'origin': fs.stat.bind(fs, path.resolve(common.options.source, 'change.json')),
          'stream': function (callback) {
            callback(null, result.content[1]);
          }
        }, this.callback);
      },

      'should match origin file stat': function (error, result) {
        assert.ifError(error);

        assert.equal(result.origin.mtime.getTime(), result.stream.mtime.getTime());
      }
    },

    'the chached file': {
      topic: function (result) {
        var self = this;
        fs.readFile(path.resolve(common.options.cache, 'change.json'), 'utf8', function (error, content) {
          self.callback(error, result.expected, content);
        });
      },

      'should be updated': function (error, expected, content) {
        assert.ifError(error);

        assert.deepEqual(JSON.parse(content), {
          first: 'first',
          second: 'second',
          state: expected
        });
      }
    }
  }

}).exportTo(module);
