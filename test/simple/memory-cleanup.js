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

var filepath = [
  path.resolve(common.fixture, 'bigfile.txt'),
  path.resolve(common.fixture, 'bigfile_2.txt')
];
var convert, expected = [], stdreadtime;

// filesize is 1024 KB (1 MB)
var size = 1024;

var filesize = 1024 * size / 2;
var buffersize = filesize * 4;

vows.describe('testing leaflet memory handler').addBatch({

  'when a leaflet object is created': {
    topic: function () {
      var self = this;
      var content;

      // will create a filesize big string
      var addition = crypto.randomBytes(filesize).toString('hex');

      // Create a filesize big file
      content = crypto.randomBytes(filesize).toString('hex');
      fs.writeFileSync(filepath[0], content);
      expected[0] = content + addition;

      // Create a filesize big file
      content = crypto.randomBytes(filesize).toString('hex');
      fs.writeFileSync(filepath[1], content);
      expected[1] = content + addition;

      // Create leaflet object
      convert = leaflet(common.options, function (error) {
        self.callback(error, null);
      });

      convert.handle('txt', 'string', function (content, next) {
        next( content + addition );
      });

      convert.memory((size * 2) + ' KB');
    },

    'there shoud not be any errors': function (error, dum) {
      assert.ifError(error);
    }
  }

}).addBatch({

  'when reading file 1 for first time': {
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

      assert.equal(content.length, buffersize);
      assert.equal(content, expected[0]);
    }
  }

}).addBatch({

  'when reading file 1 for the second time': {
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

      assert.equal(content.length, buffersize);
      assert.equal(content, expected[0]);
    }
  }

}).addBatch({

  'when reading file 1 for the third time': {
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

      assert.equal(content.length, buffersize);
      assert.equal(content, expected[0]);
    }
  }

}).addBatch({

  'when reading file 2 many times': {
    topic: function () {
      async.parallel([
        common.handleStream.bind(null, convert.read('bigfile_2.txt')),
        common.handleStream.bind(null, convert.read('bigfile_2.txt')),
        common.handleStream.bind(null, convert.read('bigfile_2.txt'))
      ], this.callback);
    },

    'the internal request counter should be set': function (error, content) {
      assert.ifError(error);

      // not public API, but there is no real way to test this
      // because of the transparenty in leaflet
      assert.equal(convert.cache['bigfile_2.txt'].request, 3);
      assert.equal(convert.cache['bigfile_2.txt'].stream, null);
    },

    'in this case the filesize should be 1 KB': function (error, content) {
      assert.ifError(error);

      assert.equal(content[0][0].length, buffersize);
      assert.equal(content[0][0], expected[1]);

      assert.equal(content[1][0].length, buffersize);
      assert.equal(content[1][0], expected[1]);

      assert.equal(content[2][0].length, buffersize);
      assert.equal(content[2][0], expected[1]);
    }
  }

}).addBatch({

  'when reading file 2 one more time than file 1': {
    topic: function () {
      var self = this;
      var now = Date.now();

      return common.handleStream(convert.read('bigfile_2.txt'), function (error, content) {
        self.callback(error, content, Date.now() - now);
      });
    },

    'the request should be read from memory': function (error, content, cachetime) {
      assert.ifError(error);

      // not public API, but there is no real way to test this
      // because of the transparenty in leaflet
      assert.equal(convert.cache['bigfile_2.txt'].request, 4);
      assert.notEqual(convert.cache['bigfile_2.txt'].stream, null);
      assert.equal(convert.cache['bigfile.txt'].stream, null);

      // Bad testcase, but if this is not true there is clearly something wrong
      assert.isTrue(cachetime < stdreadtime);
    },

    'in this case the filesize should be 1 KB': function (error, content) {
      assert.ifError(error);

      assert.equal(content.length, buffersize);
      assert.equal(content, expected[1]);
    }
  }

}).exportTo(module);
