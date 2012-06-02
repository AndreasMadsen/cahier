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
var flower = require('flower');

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
  this.cacheSize = 0;

  this.memory = {};
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
  ], callback.bind(this));
}
module.exports = function (options, callback) {
  return new Leaflet(options, callback);
};

// Check all files in `read` and process them all
var types = ['B', 'KB', 'MB', 'GB'];

Leaflet.prototype.memory = function (size) {
  if (typeof size === 'number') {
    return this.cacheSize = size;
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
  return this.cacheSize = size[0] * size[1];
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
Leaflet.prototype.read = function (filename) {
  var self = this,
      output, pipelink;

  if (this.ready === false) {
    return new Error('leaflet object is not ready');
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

  // Get stores properties
  var cacheStat = this.state[filename];

  var memory = getMemory(this, filename);

  // Increase request counter
  memory.request += 1;

  // Read from memory
  if (memory.stream && this.cacheSize) {
    output = this.cache[filename].stream.relay();
    output.pause();

    // Add to callback query if fs.stat has not completted
    if (memory.progress) {
      memory.query.push(function (mtime) {
        output.mtime = mtime;
        process.nextTick(function () {
          output.emit('stat');
        });
      });
    }

    // fs.stat has completeted stat.mtime is therefor live
    else {
      output.mtime = new Date(cacheStat.mtime);
      process.nextTick(function () {
        output.emit('stat');
      });
    }

    return output;
  }

  // in case this file isn't cached but should be cached
  var memorizeFile = (cacheStat && resolveCache(this, memory));

  if (memorizeFile) {
    pipelink = memory.stream = flower.memoryStream();

    // cleanup cache memory
    pipelink.once('close', function () {
      resolveCache(self, memory);
    });

    // Live refresh memoryStream when source file is updated
    if (this.watching) {
      memory.watch = fs.watch(source, function (event) {
        // TODO: what if the file was deleted?
        if (event !== 'change') return;

        // refresh memoryStream
        memory.stream = flower.memoryStream();
        compileSource(self, filename, source, cache, memory.stream);
      });
    }

    output = pipelink.relay();
    output.pause();
  }

  // just read from cache
  if (cacheStat && this.watching === false) {

    if (memorizeFile) {
      fs.createReadStream(cache, { bufferSize: chunkSize }).pipe(pipelink);
    } else {
      output = fs.createReadStream(cache, { bufferSize: chunkSize });
      output.pause();
    }

    output.mtime = new Date(cacheStat.mtime);
    process.nextTick(function () {
      output.emit('stat');
    });

    return output;
  }

  // create a relay stream since async handling will be needed
  if (!memorizeFile) {
    pipelink = output = flower.relayReadStream();
    output.pause();
  }

  // at this point some async opration will be required before the streams can be linked
  // set memory.inProgress flag, so mtime requests will be pushed to query
  if (memorizeFile) {
    memory.inProgress = true;

    memory.query.push(function (mtime) {
      output.mtime = mtime;
      output.emit('stat');
    });
  }

  // has never read from source before or dont need to validate source
  if (!cacheStat || this.watching === false) {
    compileSource(self, filename, source, cache, memorizeFile, pipelink);

    return output;
  }

  // check source file for modification
  fs.stat(source, function (error, stat) {
    if (error) {
      updateStat(self, filename);
      return pipelink.emit('error', error);
    }

    // source has been modified, read from source
    if (!cacheStat || stat.mtime.getTime() > cacheStat.mtime || stat.size !== cacheStat.size) {
      return compileSource(self, filename, source, cache, memorizeFile, pipelink);
    }

    // stat has not changed execute query
    // note: this could be moved up however since compileSource can be called by
    // two reasons this is the simplest solution
    if (memorizeFile) {
      var fn; while (fn = memory.query.shift()) {
        fn(cacheStat.mtime);
      }
    } else {
      pipelink.mtime = cacheStat.mtime;
      pipelink.emit('stat');
    }

    // source has not been modified, read from cache
    fs.createReadStream(cache, { bufferSize: chunkSize }).pipe(pipelink);
  });

  // return relay stream, content will be relayed to this shortly
  return output;
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

  var self = this;

  // remove all files from the cache directory
  directorySearch({
    directory: this.options.cache,

    found: function (filepath, done) {
      fs.unlink(filepath, done);
    },

    done: compile
  });

  // compile the source directory
  function compile(error) {
    if (error) return callback(error);

    directorySearch({
      directory: self.options.source,

      found: function (source, done) {
        var filename = source.substr(self.options.source.length + 1, source.length);
        var cache = path.resolve(self.options.cache, filename);

        if (self.ignorefiles.filepath.indexOf( filename ) !== -1 ||
            self.ignorefiles.filename.indexOf( path.basename(filename) ) !== -1) {
          return done();
        }

        compileSource(self, filename, source, cache, false, streamCallback(done));
      },

      done: callback
    });
  }
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
      var stream = flower.buffer2stream(input, { 'chunkSize': chunkSize });
      stream.pause();

      callback(null, stream);
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
      var stream = flower.buffer2stream(input, { 'chunkSize': chunkSize });
      stream.pause();

      callback(null, stream);
    }
  },

  'stream': {
    'buffer': function (input, callback) {
      flower.stream2buffer(input, callback);
    },

    'string': function (input, callback) {
      flower.stream2buffer(input, function (error, input) {
        callback(error, input && input.toString());
      });
    },

    'stream': function (input, callback) {
      callback(null, input);
    }
  }
};

// make a clean read
function compileSource(self, filename, source, cache, shouldMemorize, output) {

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

      // execute stat.mtime request query
      if (shouldMemorize) {
        var memory = getMemory(self, filename)
        var fn; while (fn = memory.query.shift()) {
          fn(stat.mtime);
        }
      } else {
        output.mtime = stat.mtime;
        output.emit('stat');
      }

      // create cache file write stream
      var write = fs.createWriteStream(cache);

      // pipe compiled source to cache file and output stream
      stream.pipe(write);
      stream.pipe(output);

      // also pipe errors from write to output so the users will get the all
      write.on('error', output.emit.bind(output, 'error'));

      // handle stat update
      write.once('close', function () { updateStat(self, filename, stat, write.bytesWritten); });
      write.once('error', function () { updateStat(self, filename); });
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

function directorySearch(settings, query) {
  var directory = settings.directory,
      found = settings.found;

  // All founed files and directories will be added to this query, until they are resolved
  if (query === undefined) {
    settings = extend({}, settings);
    settings.called = false;

    var done = settings.done;
    settings.done = function (error) {
      if (settings.called) return;
      settings.called = true;

      done(error);
    };

    query = [directory];
  }

  // read directory content
  fs.readdir(directory, function (error, result) {
    if (error) return settings.done(error);

    // resolve all directory files and folders
    result = result.map(function (value) {
      return path.resolve(directory, value);
    });

    // Add result to query
    query.push.apply(query, result);

    // execute done if query is empty
    query.splice(query.indexOf(directory), 1);
    if (query.length === 0) return settings.done(null);

    // resolve all content
    result.forEach(function (pathname) {
      fs.stat(pathname, function (error, stat) {
        if (error) return settings.done(error);

        // pass directory and all its content
        if (stat.isDirectory()) {
          return directorySearch(extend(settings, { 'directory': pathname }), query);
        }

        // execute found method
        found(pathname, function (error) {
          if (error) return settings.done(error);

          // remove pathname from query list
          query.splice(query.indexOf(pathname), 1);

          // execute done if query is empty
          if (query.length === 0) settings.done(null);
        });
      });
    });
  });
}

// Will check if the file is hot and clear cold memory
function resolveCache(self, memory) {
  if (self.cacheSize === Infinity) return true;
  if (self.cacheSize === 0) return false;

  // create files object sorted by number of requests
  var files = Object.keys(self.memory).map(function (filename) {
    return self.memory[filename];
  }).filter(function (file) {
    return (file.compiled !== undefined);
  }).sort(function (a, b) {
    return (a.request - b.request);
  });

  // filter files file array so it only contains files there should be cached
  var bufferCount = 0;

  files.filter(function (file) {
    bufferCount += file.compiled;

    if (bufferCount <= self.cacheSize) {
      return true;
    }

    // Cleanup cold files
    file.stream = null;
    return false;
  });

  // return true if the current file exist in array
  return files.indexOf(memory) !== -1;
}

function getMemory(self, filename) {
  var memory = self.memory[filename];

  if (memory === undefined) {
    memory = self.memory[filename] = {
      inProgress: false,
      stream: null,
      request: 0,
      query: []
    };
  }

  return memory;
}

// Update the stat
function updateStat(self, filename, stat, compiledSize) {

  // grap set value
  if (arguments.length === 4) {
    self.state[filename] = {
      mtime: stat.mtime.getTime(),
      size: stat.size,
      compiled: compiledSize
    };
    getMemory(self, filename).compiled = compiledSize;
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

// will return a simple stream and execute callback once stream is destroyed
function streamCallback(callback) {
  var output = new Stream();

  // ignore .destroy and .end relay
  output._isStdio = true;
  output.write = function () {};

  output.on('pipe', function (source) {
    source.once('end', output.emit.bind(output, 'end'));
    source.once('error', output.emit.bind(output, 'error'));
    source.resume();
  });

  output.once('end', function () {
    callback(null);
  });

  output.once('error', function (error) {
    callback(error);
  });

  return output;
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
