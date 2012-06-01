/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var vows = require('vows'),
    path = require('path'),
    fs = require('fs'),
    zlib = require('zlib'),
    async = require('async'),
    assert = require('assert'),
    crypto = require('crypto'),
    common = require('../common.js'),
    leaflet = require(common.leaflet);

// remove temp content
common.reset();

var convert;
var expexted;

vows.describe('testing leaflet converter - stream based').addBatch({

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

          // internal convert: stream => stream
          convert.handle('json', {input: 'stream', output: 'buffer'}, function (stream, next) {
            crypto.randomBytes(Math.round(64 * 1024 * 4.66666), function (error, buffer) {
              if (error) return next(error);


              expexted = new Buffer(buffer.toString('base64', 0, buffer.length));
              next(expexted);
            });
          });

          // internal convert: buffer => stream
          convert.handle('json', {input: 'stream', output: 'stream'}, function (stream, next) {
            var output = zlib.createGzip();
                output.pause();

            next(stream.pipe(output));
                 stream.resume();
          });

          // internal convert: stream => stream
          convert.handle('json', {input: 'stream', output: 'stream'}, function (stream, next) {
            var output = zlib.createGzip();
                output.pause();

            next(stream.pipe(output));
                 stream.resume();
          });

          // internal convert: stream => buffer
          convert.handle('json', {input: 'buffer', output: 'buffer'}, function (buffer, next) {
            zlib.gunzip(buffer, function (error, buffer) {
              if (error) return next(error);

              next(buffer);
            });
          });

          // internal convert: buffer => buffer
          convert.handle('json', {input: 'buffer', output: 'buffer'}, function (buffer, next) {
            zlib.gunzip(buffer, function (error, buffer) {
              if (error) return next(error);

              next(buffer);
            });
          });

          // internal convert: buffer => string
          convert.handle('json', {input: 'string', output: 'string'}, function (string, next) {
            next(string);
          });

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
      return common.handleStream( convert.read('/empty.json') );
    },

    'all internal stream convertions should work': function (error, content) {
      assert.ifError(error);

      assert.equal(content.toString(), expexted.toString());
    }
  }

}).exportTo(module);
