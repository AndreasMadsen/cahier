/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var fs = require('fs');
var util = require('util');
var path = require('path');
var async = require('async');
var mkdirp = require('mkdirp');
var equilibrium = require('equilibrium');
var Stream = require('stream');

// node < 0.8 compatibility
var exists = fs.exists || path.exists;

// platform compatibility
var dirSplit = process.platform === 'win32' ? '\\' : '/';

// chunk size (64 KB)
var chunkSize = 64 * 1024;

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
      typeof options.cache !== 'string' ||
      typeof options.state !== 'string') {

    callback(new Error('options object is not valid'));
    return this;
  }

  this.options = options;
  this.ready = false;

  this.watching = false;
  this.memory = 0;

  this.state = {};
  this.ignorefiles = {
    'filepath': [],
    'filename': []
  };
  this.handlers = {};

  // Resolve filepaths and dirpaths
  Object.keys(options).forEach(function (name) {
    options[name] = path.resolve(options[name]);
  });
  var folders = [options.read, options.cache, path.dirname(options.state)];

  async.series([

    // Create folders
    async.forEach.bind(async, folders, createDirectory),

    // Read stat file
    function (callback) {
      // Read stat file if possibol
      exists(options.state, function (exist) {

        // Set stored stat to empty object if the file don't exist
        if (exist === false) return callback();

        // Read JSON file
        fs.readFile(options.state, 'utf8', function (error, content) {

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
      self.statStream = equilibrium(self.options.state);

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
Leaflet.prototype.handle = function (/*[filetypes], options, callback*/) {
  var self = this;
  var args = Array.prototype.slice.call(arguments);

  // grap handle function
  var method = args.pop();
  var options = args.pop();
  var filetypes = args.pop() || [];

  // If options is a string, both input and output will be that string
  if (typeof options === 'string') {
    options = { input: options, output: options };
  }

  // get universial handlers and create as empty object if it don't exist
  var allHandlers = self.handlers['*'] || (self.handlers['*'] = []);

  // convert filetype to lowercase
  filetypes = filetypes.map(function (value) {
    return value.toLowerCase();
  });

  // attach universial handle to already existing file handlers and allHandlers
  if (filetypes.length === 0) {
    Object.keys(this.handlers).forEach(function (type) {
      self.handlers[type].push({
        'type': null,
        'input': options.input,
        'output': options.output,
        'method': method
      });
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
    handlers.push({
      'type': type,
      'input': options.input,
      'output': options.output,
      'method': method
    });
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
  var source = path.resolve(this.options.source, filename);
  var cache = path.resolve(this.options.cache, filename);

  // check ignorefiles list
  if (this.ignorefiles.filepath.indexOf( filename ) !== -1 ||
      this.ignorefiles.filename.indexOf( path.basename(filename) ) !== -1) {

    return streamError("ENOENT, open '" + source + "'", {
      errno: 34,
      code: 'ENOENT',
      path: source,
      ignored: true
    });
  }

  // just read from cache
  if (this.state[filename] && !this.watching) {
    return fs.createReadStream(cache, { bufferSize: chunkSize });
  }

  // create a relay stream since async handling will be needed
  var stream = new RelayStream();

  // just read from source
  if (!this.watching) {

    process.nextTick(function () {
      compileSource(self, filename, source, cache, stream);
    });

    // return relay stream, content will be relayed to this shortly
    return stream;
  }

  // check source file for modification
  fs.stat(source, function (error, stat) {
    if (error) {
      updateStat(self, filename);
      return callback(error, null);
    }

    process.nextTick(function () {
      // source has been modified, read from source
      var info = self.state[filename];
      if (stat.mtime.getTime() > info.mtime || stat.size !== info.size) {
        return compileSource(self, filename, source, cache, stream);
      }

      // source has not been modified, read from cache
      fs.createReadStream(cache, { bufferSize: chunkSize }).pipe(stream);
    });
  });

  // return relay stream, content will be relayed to this shortly
  return stream;
};

// Add a file to the ignore list, if the `read` request match it we will claim that it don't exist
Leaflet.prototype.ignore = function (filename) {

  // If this is a specific file, convert it to an absolute path
  if (filename.indexOf(dirSplit) !== -1) {
    this.ignorefiles.filepath.push( trimPath(filename) );
    return;
  }

  this.ignorefiles.filename.push(path.basename(filename));
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

  this.watching = true;
  return callback();
};

function createHandleWrap(compiler, inputType, outputType) {
  var convert = convertHandlers[inputType][outputType];

  return function (input, callback) {
    convert(input, function (error, input) {
      if (error) return callback(error, null);

      compiler(input, function (result) {
        if (result instanceof Error) {
          return callback(result, null);
        }

        callback(null, input);
      });
    });
  };
}

var convertHandlers = {
  'buffer': {
    'buffer': function (input, callback) {
      callback(null, input);
    },

    'string': function (input, callback) {
      callback(null, input.toString());
    },

    'stream': function (input, callback) {
      callback(null, new Buffer2stream(input));
    }
  },

  'string': {
    'buffer': function (input, callback) {
      callback(null, input);
    },

    'string': function (input, callback) {
      callback(null, input.toString());
    },

    'stream': function (input, callback) {
      callback(null, new Buffer2stream(input));
    }
  },

  'stream': {
    'buffer': function (input, callback) {
      stream2buffer(input, callback);
    },

    'string': function (input, callback) {
      stream2buffer(input, function (error, input) {
        callback(error, input && input.toString());
      });
    },

    'stream': function (input, callback) {
      callback(null, input);
    }
  }
};

function stream2buffer(input, callback) {
  var size = 0;
  var content = [];
  var called = true;

  input.on('data', function (chunk) {
    if (typeof chunk === 'string') {
      chunk = Buffer.isBuffer(chunk);
    }

    size += chunk.length;
    content.push(chunk);
  });

  input.on('error', function (error) {
    if (!called) callback(error, null);
  });

  input.on('end', function () {
    var buffer = new Buffer(size);
    var i = content.length;
    var pos = size;
    var from;

    while (i--) {
      from = content[i];
      pos = pos - from.length;
      from.copy(buffer, pos);
    }

    if (!called) callback(null, buffer);
  });
}

function Buffer2stream(buffer) {
  this.readable = true;
  this.writable = true;

  this.position = 0;
  this.buffer = buffer;
  this.paused = true;

  this.on('error', function (error) {
    this.writeable = false;

    if (this.listeners('error').length > 1) throw error;
  });

  this.resume();
}
util.inherits(Buffer2stream, Stream);

Buffer2stream.pause = function () {
  this.paused = true;
};

Buffer2stream.resume = function () {
  var self = this;
  this.paused = false;

  if (this.writable === false) return;

  (function writeChunk() {
    process.nextTick(function () {

      // if write stream is paused don't do anything
      if (self.paused || !self.writable) return;

      // this won't be the last writen chunk
      if (self.position + chunkSize < self.buffer.length) {
        self.write(self.buffer.slice(self.position, self.position + chunkSize));
        self.position += chunkSize;

        return writeChunk();
      }

      // last chunk
      self.end(self.buffer.slice(self.position, self.buffer.length));
    });
  })();
};

Buffer2stream.write = function (chunk) {
  this.emit('data', chunk);
  return true;
};

Buffer2stream.end = function (chunk) {
  this.write(chunk);
  this.destroy();
  this.emit('end');
};

Buffer2stream.destroy = function () {
  this.writeable = false;
  this.position = this.buffer.length;
  this.buffer = null;
  this.emit('close');
};

Buffer2stream.destroySoon = function () {
  this.destroy();
};

// make a clean read
function compileSource(self, filename, source, cache, output) {

  async.waterfall([

    // open file descriptor
    function (callback) {
      fs.open(source, function (error, fd) {
        callback(null, fd);
      });
    },

    // read stat
    function (fd, callback) {
      fs.fstat(fd, function (error, stat) {
        callback(null, fd, stat);
      });
    },

    // open read stream
    function (fd, stat, callback) {
      var stream = fs.createReadStream(source, {
        'fd': fd,
        'bufferSize': chunkSize
      });
      callback(null, fd, stat, stream);
    },

    // parse file stream
    function (fd, stat, stream, callback) {

      // resolve the order of compliers
      var handlers = resolveHandlers(self, path.extname(filename).slice(1));
      var prevType = handlers[handlers.length - 1];
      var converter = convertHandlers[prevType].stream;

      async.waterfall([
        function (callback) {
          callback(null, stream);
        }
      ].concat(handlers), function (error, result) {
        if (error) return callback(error, null);

        // convert latest result to stream object
        converter(result, function (error, stream) {
          callback(error, fd, stat, stream);
        });
      });
    }

  ], function (error, fd, stat, stream) {
    // relay any error to output stream
    if (error) {
      fs.close(fd, function () {
        output.emit('error', error);
      });

      return;
    }

    // create cache file write stream
    var write = fs.createWriteStream(cache);
    stream.pipe(write);

    // pipe stream and erros to the output stream, returned stream by .read
    stream.pipe(output);
    write.on('error', output.emit.bind(stream, 'error'));

    // save stat when write is done
    write.on('end', function () { updateStat(self, filename, stat); });

    // remove from stat if any error exist
    write.on('error', function () { updateStat(self, filename); });
    stream.on('error', function () { updateStat(self, filename); });
  });
}

function resolveHandlers(self, ext, prevType, ignore) {

  // previous will by default be stream, since fs.createReadStream returns a stream
  prevType = prevType || 'stream';

  // get source handlers
  var source = [];
  if (self.handlers[ext]) {
    source = self.handlers[ext];
  } else if (self.handlers['*'] && !ignore) {
    source = self.handlers['*'];
  }

  // will contain all handlers including resolved subhandlers
  var handlers = [];

  source.forEach(function (handle) {
    // ignore univerisal handlers
    if (ignore && handle.type === null) return;

    // Apply chain subhandlers to array
    if (typeof handle.method === 'string') {
      handlers.push.apply(handlers, resolveHandlers(self, handle.method, true));
      prevType = handlers[handlers.length - 1].output;
      return;
    }

    // Apply normal handlers
    handlers.push(createHandleWrap(handle.method, prevType, handle.input));
    prevType = handle.output;
  });

  return handlers;
}

function resolveExt(self, ext, ignore) {

  // get source handlers
  var source = [];
  if (self.handlers[ext]) {
    source = self.handlers[ext];
  } else if (self.handlers['*'] && !ignore) {
    source = self.handlers['*'];
  }

  // search all filehandlers
  var i = source.length;
  while(i--) {
    // ignore univerisal handlers
    if (ignore && source[i].type === null) continue;

    // found a chain resolve that
    if (source[i].chain) {
      return resolveExt(self, source[i].chain, true);
    }
  }

  return ext;
}

// Update the stat
function updateStat(self, filename, stat) {

  // grap set value
  if (arguments.length === 3) {
    self.state[filename] = { mtime: stat.mtime.getTime(), size: stat.size };
  } else {
    delete self.state[filename];
  }

  // save JSON file
  self.statStream.write(self.state);
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

  return filepath;
}

// create a stream object and emit a predefined error on next tick
function streamError(message, properties) {
  var stream = new Stream();
      stream.readable = true;

  var error = new Error(message);
  extend(error, properties);

  process.nextTick(function () {
    stream.emit('error', error);
  });

  return stream;
}

// Extend origin object with add
function extend(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || typeof add !== 'object') return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
}

// Will relay a stream
function RelayStream() {
  Stream.apply(this, arguments);
  this.writable = true;
  this.readable = true;

  this.paused = false;

  this.source = null;
  this.once('pipe', function (source) {
    this.source = source;

    if (this.paused) this.pause();
  });
}
util.inherits(RelayStream, Stream);
exports.RelayStream = RelayStream;

RelayStream.prototype.pause = function () {
  if (this.source) {
    this.paused = true;
    return;
  }

  return this.source.pause();
};

RelayStream.prototype.resume = function () {
  if (this.source) {
    this.paused = false;
    return;
  }

  return this.source.resume();
};

RelayStream.prototype.write = function (chunk) {
  return this.source.write(chunk);
};

RelayStream.prototype.end = function (chunk) {
  return this.source.end(chunk);
};

RelayStream.prototype.destroy = function () {
  return this.source.destroy();
};

RelayStream.prototype.destroySoon = function () {
  return this.source.destroySoon();
};
