#Leaflet

**Leaflet is a static file reading module, there will handle file processing as well**

##Installation

```sheel
npm install leaflet
```

##Example

```JavaScript
var leaflet = require('leaflet');

// setup leaflet compiler
var convert = leaflet({
  'source': path.resolve('./source'),
  'cache': path.resolve('./cache'),
  'state': path.resolve('./state.json')
});

// this will compress json files
convert.handle('json', {content: 'buffer'}, function (content, next) {
  next( JSON.stringify(JSON.parse(content)) );
});

// this will gzip all files
var zlib = requrie('zlib');
convert.handle({content: 'stream'}, function (stream, next) {
  next( stream.pipe(zlib.createGzip()) );
});

// read and compile file.json
var readStream = convert.read('/file.json');

// the return return object is a stream object there support pipe
readStream.pipe(process.stdout);

// mutiply reads of the same file is optimized
// so it resuse the underlying read stream
convert.read('/file.json').pipe(process.stdout);

// once the compile is done the file is stored in a drive cache
// so it won't have to be compiled again
readStream.once('end', function () {
  convert.read('/file.json').pipe(process.stdout);
});

// will first cleanup the drive cache and
// compile all files in the source directory
convert.compile(function () {
  console.log('compiled');
});

// besides from a drive cache you can also allocate memory to hevealy used files
convert.memory('20 MB');

// in development you may wan't to auto recompile the static files once changed
convert.watch();
```

##API documentation

_This module is not complete the above API is not implemented fully and may change_
