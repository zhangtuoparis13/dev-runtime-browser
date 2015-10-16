module.exports = function(grunt) {

  grunt.initConfig({

    jsdoc : {
      dist : {
        src: ['src/*.js', 'test/*.js'],
        options: {
          destination: 'doc'
        }
      }
    }

  });

  grunt.loadNpmTasks('grunt-jsdoc');

  grunt.registerTask('default', ['jsdoc']);

};
