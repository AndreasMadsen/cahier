#Leaflet

**Leaflet is a high performance static file reading module, without the network stuf.**

> Leaflet will handle file convertion, compression and cacheing in both memory and on HDD.
> It is totally stream based, but allow you to use both buffers and strings if needed.
> It also protects your filesystem, since it won't allow to read below the specifed source directory.

##Installation

```sheel
npm install leaflet
```

##Example

```JavaScript
var leaflet = require('leaflet');

// The leaflet compiler require a source path, a cache path
// and a state filepath. The ready callback will be execute once
// the state file is read and the necessary are created
var convert = leaflet({
  'source': path.resolve('./source'),
  'cache': path.resolve('./cache'),
  'state': path.resolve('./state.json')
}, ready);

// Leaflet allow you to attach handlers to filetypes
// This is an example of how to compress json files
convert.handle('json', 'string', function (content, next) {
  next( JSON.stringify(JSON.parse(content)) );
});

// Leaflet also supports streams
// In this example leaflet will gzpi selected txt files
var zlib = require('zlib');
convert.handle(['json', 'js', 'css'], 'stream', function (stream, next) {
  var gzip = zlib.createGzip();
      gzip.pause();

  next( stream.pipe(gzip) );
  stream.resume();
});

// leaflet is now ready
function ready(error) {
  if (error) throw error;

  // for high performance you can precompile all source files,
  // the compiled files will be stored in the cache directory
  convert.compile(function (error) {
    if (error) throw error;

    // files there hasn't been compiled will be compiled on
    // runtime and allready compiled files will be read from cache.
    var filestream = convert.read('/file.json');
        filestream.pipe(process.stdout);
        filestream.resume();
  });
}
```

##API documentation

### leaflet = LeafLet(options, callback)

`require('leaflet')` will return function there when executed returns a new leaflet instance.
The function require two arguments `options` and `callback`.

`options` is an object there must contains the following properties:
* source: an absolute path to the directory where the umcompiled source files exist.
* cache: an absolute path to the directroy where the compiled files should be stored.
* state: an absolute filepath to a JSON file, there will contain the cache state.

`callback` is an function there will be execute with an `error` argument.
If `error` is `null` no error occurred.

### leaflet.handle([filetype], usetype, handler)

This method allow you to attach an filehandler function to one or more filetypes.
The `.handle` method require three arguments `filetype`, `usetype` and `handler`.

`filetype` this can be a single filetype given by a string, or multiply filetypes listed in
an array. The value of the array items or string should only be the file extension name.
Note that if `filetype` is not specified the `handle` function will attached to all filetypes.

`handler` is a function there  is executed with three arguments `content` and `next` and `file`:
* content: is the current content of the file, this can be a `stream` a `buffer` or
a `string`. The type depend on the `usetype` argument.
* next: is a function that you must call with a output `stream`, `buffer` or `string`.
You can also execute it with an `error` object, in that case all future filehandlers will be skiped,
and the error be emitted in the returned stream object from `leaflet.read(filetype)`.
* `file` is an object containing a `path` property its value is an relative path to handled file.
Note that file argument is rarely need, but can be useful in debugging and edgecases.

`usetype` must be a string or an `object`, the object must contain two properties:
* input: the type of the first argument that the handle function is called with.
* output: the result type that the next function is called with.

The value of the properties can be `stream`, `buffer` or `string` and must reflect the usecase.
In case `usetype` is a string both the `input` and `output` type will be the value of this string.

In case that you decide to use `stream`, you must manually resume the input stream and pause
output stream, before executeing the `stream.pause()`.

### leaflet.read(filepath)

This method returns a `ReadStream` there can be piped to any `WritStream`. The method must
be executed with a _relative_ `filepath` argument. The `filepath` argument may start with `/`
indicating an `absolute` but it will be threaded as an path relative to the `source` path given
in `leaflet(options)`.

Any `../` or `./` will be handled correctly, but leaflet won't allow the user to read files below
the `source` directory. Any extra `../` indicating that will simply be skiped.

Note that the returned `ReadStream` object may emit an `error` event, if any error was cached
durrying the reading or compileing of the file. Also note that no data will be emitted from the
stream, before you manually resume the `ReadStream`.

Along with the normal `ReadStream` events and method, the stream will also emit a `stat` event.
Once emitted a `stream.mtime` property will be set, this contains a `Date` object pointing to the
`stat.mtime` of the source file.

### leaflet.ignore(filename)

When reading a file using `leaflet.read(filepath)` it will first match again an ignore list.
The match can be relative in terms of a filename or an absloute filepath.

This method adds filepaths or filenames to the ignore list. If the `filename` argument starts with
`/` it will be threaded as an absolute `filepath`, if not it will be threaded as a filename.

If a filepath match the ignore list, the returned stream object by `leaflet.read(filepath)` will
simply emit an `error` as if the file didn't exist. However the error object will have an extra
`ignore` property set to true.

### leaflet.compile(callback)

The current implementation will remove all files from `cache` directory and compile all files from
the `source` directory. When all files are compiled the `callback` will be executed. If any error
occurred the `callback` will be execute with this error as its first argument, otherwise it will be
`null`.

Note: in the future this function may cache so only non-compiled or updated files will compiled.

### leaflet.watch()

When executed leaflet will check the file stat for any modification and determin if the file should
be recompiled or just read from cached. This affect performance, but is highly useful in development.

### leaflet.memory(size)

Highly used files will be cached in a memory buffer, the total buffer size do approximately match
the given `size` argument, but since `leaflet` is stream based, the compiled and compressed size
can not be preknown with absolute certainty.

The `size` argument can be `Infinity` a number defining the size in bytes, or a simple string
like `10 MB`.

##License

**The software is license under "MIT"**

> Copyright (c) 2012 Andreas Madsen
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.
