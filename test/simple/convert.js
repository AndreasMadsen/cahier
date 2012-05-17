/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var vows = require('vows'),
    path = require('path'),
    fs = require('fs'),
    assert = require('assert'),
    common = require('../common.js'),
    leaflet = require(common.leaflet);

// remove temp content
common.reset();

var convert;
vows.describe('testing leaflet compiler').addBatch({

  'setup converter': {
    topic: function () {
      var self = this;

      // create convert object
      convert = leaflet(common.options, function (error) {
        if (error) return self.callback(error, null);

        // simpel handlers, will add first and second exports properties
        convert.handle('js', function (content, next) {
          var obj = JSON.parse(content);
              obj.first = 'first';

          next( JSON.stringify(obj) );
        });

        convert.handle('js', function (content, next) {
          var obj = JSON.parse(content);
              obj.second = 'second';

          next( JSON.stringify(obj) );
        });

        self.callback(null, null);
      });
    },

    'check that there was no errors': function (error, dum) {
      assert.ifError(error);
    }
  }

}).addBatch({

  'leaflet read file': {
    topic: function () {
      convert.read('/static.js', this.callback);
    },

    'check read content': function (error, content) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(content), {
        zero: 'zero',
        position: 'root',
        first: 'first',
        second: 'second'
      });
    }
  }

}).addBatch({

  'read drive cached file': {
    topic: function () {
      fs.readFile(path.resolve(common.temp, 'static.js'), 'utf8', this.callback);
    },

    'check read content': function (error, content) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(content), {
        zero: 'zero',
        position: 'root',
        first: 'first',
        second: 'second'
      });
    }
  }

}).exportTo(module);
