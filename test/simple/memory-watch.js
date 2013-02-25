/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var vows = require('vows'),
    async = require('async'),
    assert = require('assert'),
    common = require('../common.js'),
    cahier = require(common.cahier);

// remove temp content
common.reset();

var convert;
vows.describe('testing cahier memory watcher').addBatch({

  'when a cahier object is created': {
    topic: function () {
      var self = this;

      // Create cahier object
      convert = cahier(common.options, function (error) {
        self.callback(error, null);
      });

      convert.handle('json', 'string', function (content, next) {
        var obj = JSON.parse(content);
            obj.modified = true;

        next( JSON.stringify(obj) );
      });

      convert.memory(Infinity);
      convert.watch();
    },

    'there shoud not be any errors': function (error, dum) {
      assert.ifError(error);
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
        modified: true,
        state: 1
      });
    }
  }

}).addBatch({

  'when the source file is modified': {
    topic: function () {
      async.series({
        expected: function (callback) {
          setTimeout(function() {
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
        modified: true,
        state: result.expected
      });
    }
  }

}).addBatch({

  'when the source file is modified': {
    topic: function () {
      async.series({
        expected: function (callback) {
          common.modify(callback);
        },
        content: function (callback) {
          common.handleStream(convert.read('/change.json'), callback);
        }
      }, this.callback);
    },

   'the content should be parsed by handlers': function (error, result) {
      assert.ifError(error);

      assert.deepEqual(JSON.parse(result.content[0]), {
        modified: true,
        state: result.expected
      });
    }
  }

}).exportTo(module);
