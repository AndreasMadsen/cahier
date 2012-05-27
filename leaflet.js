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
      typeof options.source !== 'string' ||
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
  var folders = [options.source, options.cache, path.dirname(options.state)];

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
  var filetypes = args.pop();

  if (filetypes === undefined) {
    filetypes = [];
  } else if (Array.isArray(filetypes) === false) {
    filetypes = [filetypes];
  }

  if (options === undefined) {
    throw new Error('options argument was not given');
  }

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

Leaflet.prototype.convert = function (fromFiletype, toFiletype) {

  if (arguments.length !== 2) {
    throw new Error("Both filetype arguments must be specified");
  }

  // convert filetype to lower case
  fromFiletype = fromFiletype.toLowerCase();
  toFiletype = toFiletype.toLowerCase();

  // get universial handlers and create as empty object if it don't exist
  var allHandlers = this.handlers['*'] || (this.handlers['*'] = []);

  // will set handlers[type] to an array if it hasn't been done before.
  // Since already added unversial handlers should be executed first
  // we will copy the allHandlers array and use that
  var handlers = this.handlers[fromFiletype] || (this.handlers[fromFiletype] = allHandlers.slice());

  handlers.push({
    'type': fromFiletype,
    'chain': toFiletype
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
  if (this.state[filename] && this.watching === false) {
    return fs.createReadStream(cache, { bufferSize: chunkSize });
  }

  // create a relay stream since async handling will be needed
  var stream = new RelayStream();

  // just read from source
  if (!this.state[filename] || this.watching === false) {

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

    // source has been modified, read from source
    var info = self.state[filename];
    if (!info || stat.mtime.getTime() > info.mtime || stat.size !== info.size) {
      return compileSource(self, filename, source, cache, stream);
    }

    // source has not been modified, read from cache
    fs.createReadStream(cache, { bufferSize: chunkSize }).pipe(stream);
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
    throw new Error('leaflet object is not ready');
  }

  callback();
};

// Watch `read` directory for changes and update files once they are requested
Leaflet.prototype.watch = function () {
  if (this.ready === false) {
    throw new Error('leaflet object is not ready');
  }

  this.watching = true;
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

        callback(null, result);
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
  var called = false;

  input.on('data', function (chunk) {
    if (typeof chunk === 'string') {
      chunk = Buffer.isBuffer(chunk);
    }

    size += chunk.length;
    content.push(chunk);
  });

  input.on('error', function (error) {
    if (called) return;
    called = true;
    callback(error, null);
  });

  input.once('end', function () {
    var buffer = new Buffer(size);
    var i = content.length;
    var pos = size;
    var from;

    while (i--) {
      from = content[i];
      pos = pos - from.length;
      from.copy(buffer, pos);
    }

    if (called) return;
    called = true;
    callback(null, buffer);
  });

  input.resume();
}

function Buffer2stream(buffer) {
  this.readable = true;
  this.writable = false;

  this.stop = false;
  this.position = 0;
  this.buffer = buffer;
  this.paused = true;

  this.on('error', function (error) {
    this.stop = true;

    if (this.listeners('error').length > 1) throw error;
  });
}
util.inherits(Buffer2stream, Stream);

Buffer2stream.prototype.pause = function () {
  this.paused = true;
};

Buffer2stream.prototype.resume = function () {
  var self = this;
  this.paused = false;
  if (this.stop === true) return;

  (function writeChunk() {
    process.nextTick(function () {

      // if write stream is paused don't do anything
      if (self.paused || self.stop) return;

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

Buffer2stream.prototype.write = function (chunk) {
  this.emit('data', chunk);
  return !this.stop;
};

Buffer2stream.prototype.end = function (chunk) {
  if (chunk && !this.stop) this.write(chunk);
  this.stop = true;
  this.emit('end');
  this.destroy();
};

Buffer2stream.prototype.destroy = function () {
  if (this.buffer === null) return;

  this.stop = true;
  this.position = this.buffer.length;
  this.buffer = null;
  this.emit('close');
};

Buffer2stream.prototype.destroySoon = function () {
  this.destroy();
};

// make a clean read
function compileSource(self, filename, source, cache, output) {

  async.waterfall([

    // open file descriptor
    function (callback) {
      fs.open(source, 'r', function (error, fd) {
        callback(error, fd);
      });
    },

    // read stat
    function (fd, callback) {
      fs.fstat(fd, function (error, stat) {
        callback(error, fd, stat);
      });
    },

    // open read stream
    function (fd, stat, callback) {
      var stream = fs.createReadStream(source, {
        'fd': fd,
        'bufferSize': chunkSize
      });

      // Note late node 0.6 bug: joyent/node#3328
      stream.pause();

      callback(null, fd, stat, stream);
    },

    // parse file stream
    function (fd, stat, stream, callback) {

      // resolve the order of compliers
      var result = resolveHandlers(self, path.extname(filename).slice(1));
      var handlers = result.handlers;
      var prevType = result.prevType;
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
      if (fd) {
        return fs.close(fd, function () {
          output.emit('error', error);
        });
      }

      return output.emit('error', error);
    }

    // create cache subdirectory
    createDirectory(path.dirname(cache), function (error) {
      if (error) return output.emit('error', error);

      // hack: somehow the fd is closed prematurly by createWriteStream by default
      // that is why we takes total control
      fs.open(cache, 'w', function (error, fd) {
        if (error) return output.emit('error', error);

        // create cache file write stream
        var write = fs.createWriteStream(cache, { 'fd': fd });
        stream.pipe(write);

        // also pipe errors from write to output so the users will get the all
        write.on('error', output.emit.bind(stream, 'error'));

        // once write is done we can simply close the fd
        write.once('close', function () {
          fs.close(fd);
        });

        // pipe stream to output stream
        // note since a stream:close emit will by default result in a output.destroy() execute
        // and we on the same time want users to be able to destroy a stream by output.destroy()
        // we wont automaticly pipe stream:close, but ignore it in stream.pipe and manually relay
        // the close and end event
        stream.pipe(output, { end: false });
        stream.once('end', output.emit.bind(output, 'end'));
        stream.once('close', output.emit.bind(output, 'close'));

        // handle stat update
        write.once('close', function () { updateStat(self, filename, stat); });
        write.once('error', function () { updateStat(self, filename); });
        stream.once('error', function () { updateStat(self, filename); });

        // begin buffer stream
        stream.resume();
      });

    });
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
    if (handle.chain) {
      var result = resolveHandlers(self, handle.chain, prevType, true);
      handlers.push.apply(handlers, result.handlers);
      prevType = result.prevType;
      return;
    }

    // Apply normal handlers
    handlers.push(createHandleWrap(handle.method, prevType, handle.input));
    prevType = handle.output;
  });

  // a little confusing, but seams to be the shortest way
  return {
    'handlers': handlers,
    'prevType': prevType
  };
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

// quick argument converter
function toArray(input) {
  var output = [];
  for (var i = 0, l = input.length; i < l; i++) {
    output.push(input[i]);
  }
  return output;
}

// Will relay a stream
function RelayStream() {
  Stream.apply(this, arguments);
  this.readable = true;
  this.writable = true;

  this.query = [];

  this.source = null;
  this.once('pipe', function (source) {
    this.source = source;

    var method;
    while (method = this.query.shift()) {
      method.fn.apply(this, method.args);
    }
  });
}
util.inherits(RelayStream, Stream);
exports.RelayStream = RelayStream;

RelayStream.prototype.pause = function () {
  if (this.source) return this.source.pause.apply(this.source, arguments);

  this.query.push({ 'fn': this.pause, 'args': arguments });
};

RelayStream.prototype.resume = function () {
  if (this.source) return this.source.resume.apply(this.source, arguments);

  this.query.push({ 'fn': this.resume, 'args': arguments });
};

RelayStream.prototype.write = function () {
  var args = toArray(arguments);

  if (this.source) {
    return this.emit.apply(this, ['data'].concat(args));
  }

  this.query.push({ 'fn': this.write, 'args': ['data'].concat(args) });
};

RelayStream.prototype.end = function () {
  var args = toArray(arguments);

  // if chunks are given
  if (args.length > 0) {
    this.write.apply(this, args);
  }

  if (this.source) {
    return this.emit('end');
  }

  this.query.push({ 'fn': this.end, 'args': ['end']});
};

RelayStream.prototype.destroy = function () {
  if (this.source) return this.source.destroy.apply(this.source, arguments);

  this.query.push({ 'fn': this.destroy, 'args': arguments });
};

RelayStream.prototype.destroySoon = function () {
  if (this.source) return this.source.destroySoon.apply(this.source, arguments);

  this.query.push({ 'fn': this.destroySoon, 'args': arguments });
};
