/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var vows = require('vows'),
    path = require('path'),
    fs = require('fs'),
    crypto = require('crypto'),
    async = require('async'),
    assert = require('assert'),
    common = require('../common.js'),
    leaflet = require(common.leaflet);

// remove temp content
common.reset();

var filepath = path.resolve(common.fixture, 'bigfile.txt');
var convert, expected, stdreadtime;

vows.describe('testing leaflet memory handler').addBatch({

  'when a leaflet object is created': {
    topic: function () {
      var self = this;

      // Create a 0.5 KB big file
      var content = crypto.randomBytes(256).toString('hex');
      fs.writeFileSync(filepath, content);

      // will create a 0.5 KB string
      var addition = crypto.randomBytes(256).toString('hex');

      // store pseudo compiled content
      expected = content + addition;

      convert = leaflet(common.options, function (error) {
        self.callback(error, null);
      });

      convert.handle('txt', 'string', function (content, next) {
        next( content + addition );
      });

      convert.memory('1 KB');
    },

    'there shoud not be any errors': function (error, dum) {
      assert.ifError(error);
    }
  }

}).addBatch({

  'when reading for first time': {
    topic: function () {
      return common.handleStream(convert.read('bigfile.txt'));
    },

    'the internal request counter should be set': function (error, content) {
      assert.ifError(error);

      // not public API, but there is no real way to test this
      // because of the transparenty in leaflet
      assert.equal(convert.cache['bigfile.txt'].request, 1);
    },

    'in this case the filesize should be 1 KB': function (error, content) {
      assert.ifError(error);

      assert.equal(content.length, 1024);
      assert.equal(content, expected);
    }
  }

}).addBatch({

  'when reading for the second time': {
    topic: function () {
      var self = this;

      // After about 500 ms the
      var now = Date.now();

      common.handleStream(convert.read('bigfile.txt'), function (error, content) {
        stdreadtime = Date.now() - now;
          self.callback(error, content);
      });
    },

    'the request should be stored in memory': function (error, content) {
      assert.ifError(error);

      // not public API, but there is no real way to test this
      // because of the transparenty in leaflet
      assert.equal(convert.cache['bigfile.txt'].request, 2);
      assert.notEqual(convert.cache['bigfile.txt'].stream, null);
    },

    'in this case the filesize should be 1 KB': function (error, content) {
      assert.ifError(error);

      assert.equal(content.length, 1024);
      assert.equal(content, expected);
    }
  }

}).addBatch({

  'when reading for the third time': {
    topic: function () {
      var self = this;
      var now = Date.now();

      return common.handleStream(convert.read('bigfile.txt'), function (error, content) {
        self.callback(error, content, Date.now() - now);
      });
    },

    'the request should be read from memory': function (error, content, cachetime) {
      assert.ifError(error);

      // not public API, but there is no real way to test this
      // because of the transparenty in leaflet
      assert.equal(convert.cache['bigfile.txt'].request, 3);
      assert.notEqual(convert.cache['bigfile.txt'].stream, null);

      // Bad testcase, but if this is not true there is clearly something wrong
      assert.isTrue(cachetime < stdreadtime);
    },

    'in this case the filesize should be 1 KB': function (error, content) {
      assert.ifError(error);

      assert.equal(content.length, 1024);
      assert.equal(content, expected);
    }
  }

}).exportTo(module);
