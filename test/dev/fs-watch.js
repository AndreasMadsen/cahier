/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var path = require('path'),
    fs = require('fs'),
    async = require('async'),
    common = require('../common.js');

// remove temp content
common.reset();
fs.mkdirSync(common.temp);

// watch the temp directory
fs.watch(common.temp, function (event, filename) {
  console.log('dir: ' + filename + ' did ' + event);
});

// we shoud be ready
setTimeout(function () {
  fs.open(path.resolve(common.temp, 'create.json'), 'w+', function (error, fd) {

    setTimeout(function () {
      var buffer = new Buffer('-');
      fs.write(fd, buffer, 0, buffer.length, 0, function (error) {

        fs.watch(path.resolve(common.temp, 'create.json'), function (event, filename) {
          console.log('file: ' + filename + ' did ' + event);
        });

        setTimeout(function () {
          fs.truncate(fd, 0, function () {

            setTimeout(function () {
              var buffer = new Buffer('abc');
              fs.write(fd, buffer, 0, buffer.length, 0, function (error) {

                setTimeout(function () {
                  var buffer = new Buffer('def');
                  fs.write(fd, buffer, 0, buffer.length, 3, function (error) {

                    setTimeout(function () {
                      fs.unlink(path.resolve(common.temp, 'create.json'), function () {
                        console.log('done');
                      });
                    }, 200);

                  });
                }, 200);

              });
            }, 200);

          });
        }, 200);

      });
    }, 200);

  });
}, 200);
