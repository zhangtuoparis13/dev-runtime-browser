var babel = require('babelify');
var browserify = require('browserify');
var buffer = require('vinyl-buffer');
var source = require('vinyl-source-stream');
var sourcemaps = require('gulp-sourcemaps');
var replace = require('gulp-replace');
var insert = require('gulp-insert');
var uglify = require('gulp-uglify');
var bump = require('gulp-bump');
var argv = require('yargs').argv;
var through = require('through2');
var path = require('path');
var gulpif = require('gulp-if');
var pkg = require('./package.json');
var gulp = require('gulp');
var exec = require('child_process').exec;

// Gulp task to generate development documentation;
gulp.task('doc', function(done) {

  console.log('Generating documentation...');
  exec('node_modules/.bin/jsdoc -R readme.md -d docs src/*', function(err, stdout, stderr) {
    if (err) return done(err);
    console.log('Documentation generated in "docs" directory');
    done();
  });

});

// Gulp task to include license in source code files
gulp.task('license', function() {

  var clean = argv.clean;
  if (!clean) clean = false;

  return gulp.src(['src/**/*.js'])
  .pipe(prependLicense(clean));

});

function prependLicense(clean) {

  var license = `/**
* Copyright 2016 PT Inovação e Sistemas SA
* Copyright 2016 INESC-ID
* Copyright 2016 QUOBIS NETWORKS SL
* Copyright 2016 FRAUNHOFER-GESELLSCHAFT ZUR FOERDERUNG DER ANGEWANDTEN FORSCHUNG E.V
* Copyright 2016 ORANGE SA
* Copyright 2016 Deutsche Telekom AG
* Copyright 2016 Apizee
* Copyright 2016 TECHNISCHE UNIVERSITAT BERLIN
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/
`;

  return through.obj(function(file, enc, cb) {

    if (file.isNull()) {
      return cb(new Error('Fil is null'));
    }

    if (file.isStream()) {
      return cb(new Error('Streaming not supported'));
    }

    var dest = path.dirname(file.path);

    return gulp.src(file.path)
    .pipe(replace(license, ''))
    .pipe(gulpif(!clean, insert.prepend(license)))
    .pipe(gulp.dest(dest))
    .on('end', function() {
      cb();
    });

  });

}

// Gulp task to bundle files
function bundle(file_name, bundle_name, dest) {

  var bundler = browserify(file_name, {
      standalone: bundle_name, debug: true, transform: [['babelify', {"presets": ["es2015"], "plugins": ["transform-object-assign"]}]]});

  function rebundle() {
    return bundler.bundle()
      .on('error', function(err) {
        console.error(err);
        this.emit('end');
      })
      .pipe(source(bundle_name + '.js'))
      .pipe(buffer())
      .pipe(sourcemaps.init({loadMaps: true}))
      .pipe(uglify())
      .pipe(sourcemaps.write('./'))
      .pipe(replace('{{version}}', pkg.version))
      .pipe(gulp.dest(dest));
  }

  return rebundle();

}

gulp.task('bundle:rethink', function(){
    return bundle('./src/RuntimeLoader.js', 'rethink', 'bin')
});
gulp.task('bundle:core', function(){
    return bundle('./src/core.js', 'core', 'bin')
});

gulp.task('bundle:policies-gui', function () {
  return bundle('./src/admin/PoliciesGUI.js', 'policies-gui', 'bin');
});

gulp.task('bundle:identities-gui', function () {
  return bundle('./src/admin/IdentitiesGUI.js', 'identities-gui', 'bin');
});

gulp.task('bundle:context', function(){
    return bundle('./src/ContextServiceProvider.js', 'context-service', 'bin')
});

gulp.task('bundle:dist', ['bundle:rethink', 'bundle:core', 'bundle:context']);

gulp.task('bundle:demo1', function(){
    return bundle('./example/demo.js', 'demo.bundle', 'example')
});
gulp.task('bundle:demo2', function(){
    return bundle('./example/demo2.js', 'demo2.bundle', 'example')
});
gulp.task('bundle:hello', function(){
    return bundle('./example/hello.js', 'hello.bundle', 'example')
});

gulp.task('bundle:demo', ['bundle:demo1', 'bundle:demo2', 'bundle:hello']);
/**
 * Bumping version number and tagging the repository with it.
 * Please read http://semver.org/
 *
 * You can use the commands
 *
 *     gulp patch     # makes v0.1.0 → v0.1.1
 *     gulp feature   # makes v0.1.1 → v0.2.0
 *     gulp release   # makes v0.2.1 → v1.0.0
 *
 * To bump the version numbers accordingly after you did a patch,
 * introduced a feature or made a backwards-incompatible release.
 */
function inc(importance) {
  // get all the files to bump version in
  return gulp.src(['./package.json'])

    // bump the version number in those files
    .pipe(bump({type: importance}))

    // save it back to filesystem
   .pipe(gulp.dest('./'));
}

gulp.task('patch', function() { return inc('patch'); });

gulp.task('feature', function() { return inc('minor'); });

gulp.task('release', function() { return inc('major'); });
