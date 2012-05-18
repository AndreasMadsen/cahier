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
vows.describe('testing leaflet compiler').addBatch({

  'when a leaflet object is created': {
    topic: function () {
      var self = this;

      // create convert object
      convert = leaflet(common.options, function (error) {
        if (error) return self.callback(error, null);

        // simpel handlers, will add first and second exports properties
        convert.handle('json', function (content, next) {
          var obj = JSON.parse(content);
              obj.first = 'first';

          next( JSON.stringify(obj) );
        });

        convert.handle('json', function (content, next) {
          var obj = JSON.parse(content);
              obj.second = 'second';

          next( JSON.stringify(obj) );
        });

        self.callback(null, null);
      });
    },

    'check that the temp directory was created': function (error, dum) {
      assert.ifError(error);

      assert.isTrue(common.existsSync(common.options.cache));
    },

    'check that the stat file was created': function (error, dum) {
      assert.ifError(error);

      assert.isTrue(common.existsSync(common.options.cache));
    }
  }

}).addBatch({

  'when reading a file for first time': {
    topic: function () {
      convert.read('/static.json', this.callback);
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
        async.parallel({
          'origin': fs.stat.bind(fs, path.resolve(common.options.read, 'static.json')),
          'cache': fs.readFile.bind(fs, common.options.state, 'utf8')
        }, this.callback);
      },

      'should be updated': function (error, result) {
        assert.equal(result.origin.mtime.getTime(), JSON.parse(result.cache)['static.json']);
      }
    },

    'the chached file': {
      topic: function () {
        fs.readFile(path.resolve(common.options.cache, 'static.json'), 'utf8', this.callback);
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

}).addBatch({

  'when reading a file second time': {
    topic: function () {
      async.waterfall([

        // read cache file
        fs.readFile.bind(fs, path.resolve(common.options.cache, 'static.json'), 'utf8'),

        // manipulate
        function (content, callback) {
          var obj = JSON.parse(content);
              obj.manipulated = true;

          callback(null, JSON.stringify(obj));
        },

        // overwrite cache file
        fs.writeFile.bind(fs, path.resolve(common.options.cache, 'static.json')),

        // get file using leaflet
        convert.read.bind(convert, '/static.json')

      ], this.callback);
    },

    'the content should be read from cache directory': function (error, content) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(content), {
        zero: 'zero',
        position: 'root',
        first: 'first',
        second: 'second',
        manipulated: true
      });
    }
  }

}).exportTo(module);
