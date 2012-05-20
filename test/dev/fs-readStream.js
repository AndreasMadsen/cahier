/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var path = require('path'),
    fs = require('fs'),
    async = require('async'),
    crypto = require('crypto'),
    common = require('../common.js');

// remove temp content
common.reset();
fs.mkdirSync(common.temp);

// create 6 random files with equal length
var size = 1024*1024;
var buffer = crypto.randomBytes(size);

var files = ('abcdefghijkl').split('').map(function (value) {
  return path.resolve(common.temp, value + '.txt');
});

// Create the big files
files.forEach(function (filepath) {
  fs.writeFileSync(filepath, buffer);
});

// Read seperate files
function step1() {
  console.time('seperate files parallel');
  var query = files.slice(0, 5).map(function (filepath) {
    return function (callback) {
      var stream = fs.createReadStream(filepath);
      stream.on('close', callback);
    };
  });

  async.parallel(query, function () {
    console.timeEnd('seperate files parallel');
    step2();
  });
}

// Read seperate files
function step2() {
  console.time('seperate files series');
  var query = files.slice(5, 10).map(function (filepath) {
    return function (callback) {
      var stream = fs.createReadStream(filepath);
      stream.on('close', callback);
    };
  });

  async.series(query, function () {
    console.timeEnd('seperate files series');
    step3();
  });
}

function step3() {
  console.time('same files parallel');

  var query = [1,2,3,4,5].map(function () {
    return function (callback) {
      var stream = fs.createReadStream(files[10]);
      stream.on('close', callback);
    };
  });

  async.parallel(query, function () {
    console.timeEnd('same files parallel');
    step4();
  });
}


// Read seperate files
function step4() {
  console.time('same files series');

  var query = [1,2,3,4,5].map(function () {
    return function (callback) {
      var stream = fs.createReadStream(files[11]);
      stream.on('close', callback);
    };
  });

  async.series(query, function () {
    console.timeEnd('same files series');
  });
}

step1();

