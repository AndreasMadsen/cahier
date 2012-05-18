/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var fs = require('fs');
var path = require('path');
var async = require('async');
var mkdirp = require('mkdirp');
var equilibrium = require('equilibrium');

// node < 0.8 compatibility
var exists = fs.exists || path.exists;

function Leaflet(options, callback) {
  var self = this;

  // Check callback
  if (typeof callback !== 'function') {
    throw new Error('callback is missing');
  }

  // Check options
  if (options === null ||
      typeof options !== 'object' ||
      typeof options.read !== 'string' ||
      typeof options.write !== 'string' ||
      typeof options.stat !== 'string') {

    callback(new Error('options object is not valid'));
    return this;
  }

  this.options = options;
  this.handlers = {};
  this.ready = false;
  this.memory = 0;
  this.state = {};
  this.query = {};

  // Resolve filepaths and dirpaths
  Object.keys(options).forEach(function (name) {
    options[name] = path.resolve(options[name]);
  });
  var folders = [options.read, options.write, path.dirname(options.stat)];

  async.series([

    // Create folders
    async.forEach.bind(async, folders, createDirectory),

    // Read stat file
    function (callback) {
      // Read stat file if possibol
      exists(options.stat, function (exist) {

        // Set stored stat to empty object if the file don't exist
        if (exist === false) return callback();

        // Read JSON file
        fs.readFile(options.stat, 'utf8', function (error, content) {

          // Parse JSON and catch errors
          try {
            self.stat = JSON.parse(content);
          } catch (error) {
            return callback(error);
          }

          callback();
        });
      });
    },

    // Open stat stream
    function (callback) {
      self.statStream = equilibrium(self.options.stat);

      function errorFn(error) {
        self.statStream.removeListener('open', openFn);
        callback(error);
      }

      function openFn() {
        self.statStream.removeListener('error', errorFn);
        self.ready = true;
        callback(null);
      }

      self.statStream.once('error', errorFn);
      self.statStream.once('open', openFn);

      self.statStream.open();
    }
  ], callback);
}
module.exports = function (options, callback) {
  return new Leaflet(options, callback);
};

// Check all files in `read` and process them all
var types = ['B', 'KB', 'MB', 'GB'];

Leaflet.prototype.memory = function (size) {
  if (typeof size === 'number') {
    return this.memory = size;
  }

  // convert string to number
  size = size.split(" ").map(function (value) {
    var exp = types.indexOf(types);

    // Parse string as number
    if (exp === -1) {
      return parseInt(value, 10);
    }

    // Convert *B to bytes number
    return Math.pow(1024, exp);
  });

  // Calculate new size
  return this.memory = size[0] * size[1];
};

// Attach handler to given filetypes
Leaflet.prototype.handle = function () {
  var self = this;
  var args = Array.prototype.slice.call(arguments);

  // grap handle function
  var handle = args.pop();

  // get universial handlers and create as empty object if it don't exist
  var allHandlers = self.handlers['*'] || (self.handlers['*'] = []);

  // convert filetype to lowercase
  var filetypes = args.map(function (value) {
    return value.toLowerCase();
  });

  // attach universial handle to already existing file handlers and allHandlers
  if (filetypes.length === 0) {
    Object.keys(this.handlers).forEach(function (type) {
      self.handlers[type].push(handle);
    });

    return;
  }

  // Attach handle to all filetypes
  filetypes.forEach(function (type) {

    // will set handlers[type] to an array if it hasn't been done before.
    // Since already added unversial handlers should be executed first
    // we will copy the allHandlers array and use that
    var handlers = self.handlers[type] || (self.handlers[type] = allHandlers.slice());

    // attach handle function
    handlers.push(handle);
  });
};

// Read and process file, if the file don't exist in memory, `write` directory
// or has been reset by Leaflet.watch
Leaflet.prototype.read = function (filename, callback) {
  var self = this;

  if (this.ready === false) {
    return callback(new Error('leaflet object is not ready'));
  }

  // absolute paths will be relative to read dir
  filename = trimPath(filename);

  // resolve read and write filepath
  var read = path.resolve(this.options.read, filename);
  var write = path.resolve(this.options.write, filename);

  // create or get callback array
  var callbacks = this.query[filename] || (this.query[filename] = []);

  // append this callback to the stack
  callbacks.push(callback);

  // Just wait if fs.read is in progress
  if (callback.length > 1) {
    return;
  }

  // Try reading data from disk cache
  if (this.state[filename]) {
    fs.readFile(write, 'utf8', function (error, content) {

      // in case there was an error, make a clean read
      if (error) {
        updateStat(self, filename);
        return beginReading();
      }

      // Execute all callbacks
      executeCallbacks(callbacks, null, content);
    });

    return;
  }

  (function beginReading() {
    cleanRead(self, read, filename, function (error, stat, content) {
      // In case there was an error, remove file from stat and send error to all callbacks
      if (error) {
        updateStat(self, filename);
        return executeCallbacks(callbacks, error, null);
      }

      // Set modified time in stat store
      updateStat(self, filename, stat.mtime);

      // Execute all callbacks
      executeCallbacks(callbacks, null, content);
    });
  })();
};

// Find all files in `read` and process them all
Leaflet.prototype.compile = function (callback) {
  if (this.ready === false) {
    return callback(new Error('leaflet object is not ready'));
  }

  callback();
};

// Watch `read` directory for changes and update files once they are requested
Leaflet.prototype.watch = function (callback) {
  if (this.ready === false) {
    return callback(new Error('leaflet object is not ready'));
  }
};

// run file handlers
function handleFile(self, filename, content, callback) {

  // get filetype handlers
  var ext = path.extname(filename).slice(1);
  var handlers = (self.handlers[ext] || self.handlers['*']);

  // Skip parseing if there are no handlers
  if (handlers === undefined) {
    callback(null, content);
  }

  // Wrap handlers so they take both error and content as first argument
  handlers = handlers.map(function (handle) {
    return function (content, callback) {
      handle(content, function (result) {
        if (result instanceof Error) return callback(result, null);
        callback(null, result);
      });
    };
  });

  // execute all filetype handlers
  async.waterfall([
    function (callback) {
      callback(null, content);
    }
  ].concat(handlers), callback);
}

// Execute callback stack
function executeCallbacks(callbacks, error, content) {
  var fn;
  while (fn = callbacks.shift()) {
    fn(error, content);
  }
}

// make a clean read
function cleanRead(self, read, filename, callback) {
  async.waterfall([
    // open fd
    function (callback) {
      fs.open(read, 'r', callback);
    },

    // read file stat
    function (fd, callback) {
      fs.fstat(fd, function (error, stat) {
        callback(error, fd, stat);
      });
    },

    // read file content
    function (fd, stat, callback) {
      var buffer = new Buffer(stat.size);
      fs.read(fd, buffer, 0, buffer.length, 0, function (error) {
        callback(error, stat, buffer);
      });
    },

    // convert buffer handlers
    function (stat, buffer, callback) {
      handleFile(self, filename, buffer.toString(), function (error, content) {
        callback(error, stat, content);
      });
    },

    // All good, lets update stat cache and send callback
    function (stat, content, callback) {
      var filepath = path.resolve(self.options.write, filename);
      fs.writeFile(filepath, content, function (error) {
        callback(error, stat, content);
      });
    }
  ], callback);
}

// Update the stat
function updateStat(self, filename, value) {

  // grap set value
  if (arguments.length === 3) {
    self.state[filename] = value.getTime();
  } else {
    delete self.state[filename];
  }

  // save JSON file
  self.statStream.write(JSON.stringify(self.state));
}

// Check if directory exist and create if not
function createDirectory(dirpath, callback) {
  exists(dirpath, function (exist) {
    if (exist) return callback(null);

    mkdirp(dirpath, function (error) {
      if (error) callback(error);

      callback(null);
    });
  });
}

// Trim path safely
var dirSplit = process.platform === 'win32' ? '\\' : '/';
var ignorePaths = ['', '.', '..'];
function trimPath(filepath) {

  // resolve and move all ../ to the begining
  filepath = path.normalize(filepath);

  // remove all ../
  filepath = filepath.split(dirSplit);
  filepath = filepath.filter(function (value) {
    return ignorePaths.indexOf(value) === -1;
  });

  // combine filepath
  filepath = filepath.join(dirSplit);

  // remove ./ and / too
  if (filepath[0] === '.') filepath = filepath.slice(1);
  if (filepath[0] === dirSplit) filepath = filepath.slice(1);

  return filepath;
}
