/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var equilibrium = require('equilibrium');

// node < 0.8 compatibility
var exists = fs.exists || path.exists;

function Leaflet(options, callback) {
  var self = this;

  // Check options
  if (typeof options !== 'object' ||
      options === null ||
      Object.keys(options) !== ['read', 'write', 'stat']) {
    callback(new Error('options object is not valid'));
  }

  // Resolve filepaths and dirpaths
  this.options = options;
  this.handlers = {};
  this.ready = false;
  this.memory = 0;
  this.stats = {};

  Object.keys(options).forEach(function (name) {
    options[name] = path.resolve(options[name]);
  });

  // Setup progress tracker
  var track = new ProgressTracker(function (error) {
    if (error) return callback(error);

    // No errors we are ready :D
    self.ready = true;
    callback();
  });
  track.add(['read', 'write', 'stat']);

  // Check/Create directories
  createDirectory(options.read, track.set.bind(track, 'read'));
  createDirectory(options.write, track.set.bind(track, 'write'));

  // Read stat file if possibol
  exists(options.stat, function (exist) {

    // Set stored stat to empty object if the file don't exist
    if (exist === false) return track.set('stat');

    // Read JSON file
    fs.readFile(options.stat, 'utf8', function (error, content) {
      if (error) return track.set('stat', error);

      // Parse JSON and catch errors
      try {
        self.stat = JSON.parse(content);
      } catch (error) {
        return track.set('stat', error);
      }

      // Open stat stream
      self.statStream = equilibrium(self.options.stat);
      self.statStream.open();
    });
  });
}
module.exports = function () { return new Leaflet(); };

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
  var filetypes = args.map(String.prototype.toLowerCase.call);

  // attach universial handle to already existing file handlers and allHandlers
  if (filetypes.length === 0) {
    Object.keys(this.handlers).forEach(function (type) {
      self.handlers[type].push(handle);
    });

    return;
  }

  // Attach handle to all filetypes
  filetypes.forEach(function (type) {

    // will set handlers[type] to an array if it hasn't been done before
    // since already added unversial handlers should be executed first
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

  // Try reading data from disk cache
  if (this.stat[filename]) {
    fs.readFile(write, 'utf8', function (error, content) {
      if (error) {
        updateStat(self, filename);
        return cleanRead();
      }

      callback(null, content);
    });

    return;
  }

  // make a clean read
  (function cleanRead() {
    fs.open(read, 'r', function (error, fd) {
      if (error) {
        updateStat(self, filename);
        return callback(error, null);
      }

      fs.fstat(fd, function (error, stat) {
        if (error) {
          updateStat(self, filename);
          return callback(error, null);
        }

        fs.read(fd, new Buffer(stat.size), 0, stat.size, 0, function (error, buffer) {
          if (error) {
            updateStat(self, filename);
            return callback(error, null);
          }

          // run file handlers
          handleFile(self, filename, buffer.toString('utf8'), function (error, content) {
            if (error) {
              updateStat(self, filename);
              return callback(error, null);
            }

            // All good, lets update stat cache and send callback
            fs.writeFile(filename, content, function (error) {
              if (error) {
                updateStat(self, filename);
                return callback(error, null);
              }

              updateStat(self, filename, stat.mtime);
            });
          });
        });
      });
    });
  })();
};

// Find all files in `read` and process them all
Leaflet.prototype.compile = function (callback) {
  if (this.ready === false) {
    return callback(new Error('leaflet object is not ready'));
  }
};

// Watch `read` directory for changes and update files once they are requested
Leaflet.prototype.watch = function (callback) {
  if (this.ready === false) {
    return callback(new Error('leaflet object is not ready'));
  }
};

// run file handlers
function handleFile(self, filename, content, callback) {
  var ext = path.extname(filename).slice(1);
  var handlers = (self[ext] || self['*'] || []).slice();

  (function execute() {
    // get the first/next handler
    var handle = handlers.shift();

    // done, no more handlers
    if (handle === undefined) return callback(null, content);

    // execute handle
    handle(content, function (respons) {
      if (respons instanceof Error) {
        return callback(respons, null);
      }

      // Update content in outer scope
      content = respons;

      // execute next handler
      execute();
    });
  })();
}

// Update the stat
function updateStat(self, filename, value) {

  // grap set value
  if (arguments.length === 3) {
    self.stat[filename] = value;
  } else {
    delete self.stat[filename];
  }

  // save JSON file
  self.statStream.write(JSON.stringify(self.stat));
}

// Extremely simple progress tracker
function ProgressTracker(callback) {
  this.list = [];
  this.callback = callback;
  this.called = false;
  this.error = null;
}
exports.ProgressTracker = ProgressTracker;

ProgressTracker.prototype.add = function (list) {
  if (!Array.isArray(list)) list = [list];
  this.list = this.list.concat(list);
};
ProgressTracker.prototype.set = function(name, error) {
  this.list.splice(this.list.indexOf(name), 1);
  this.error = error;
  this.check();
};
ProgressTracker.prototype.check = function() {
  if (this.called) return;

  if (this.error || this.list.length === 0) {
    this.called = true;
    this.callback(this.error);
  }
};

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
var dirSplit = process.platform === 'win32' ? '/' : '\\';
function trimPath(filepath) {

  // resolve and move all ../ to the begining
  filepath = path.normalize(filepath);

  // remove all ../
  filepath = filepath.split(dirSplit);
  filepath = filepath.filter(function (value) {
    return value !== '..';
  });

  // combine filepath
  filepath = filepath.join(dirSplit);

  // remove ./ too
  if (filepath[0] === '.' && filepath[1] === dirSplit) {
    filepath = filepath.slice(2);
  }

  return filepath;
}
