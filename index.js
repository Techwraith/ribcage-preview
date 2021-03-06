'use strict'

var atomify = require('atomify')
  , htmlifyError = require('atomify/lib/htmlifyError.js')
  , assign = require('lodash/object/assign')
  , path = require('path')
  , fs = require('fs')
  , chalk = require('chalk')
  , a11y = require('react-a11y')
  , cwd = process.cwd()
  , internals = {}

internals.findFirstFile = function findFirstFile (dir, filenames) {
  var entryPath
    , i
    , l

  for (i = 0, l = filenames.length; i < l; i++){
    entryPath = path.join(dir, filenames[i])
    if (fs.existsSync(entryPath)){
      return entryPath
    }
  }
}

internals.findEntryJs = function findEntryJs (dir) {
  return internals.findFirstFile(dir, ['entry.js', 'entry.jsx', 'index.js', 'index.jsx'])
}

internals.findEntryCss = function findEntryCss (dir) {
  return internals.findFirstFile(dir, ['entry.css', 'index.css'])
}

internals.findEntryHTML = function findEntryHTML (dir) {
  return internals.findFirstFile(dir, ['entry.html', 'index.html'])
}

internals.findEntryData = function findEntryHTML (dir) {
  return internals.findFirstFile(dir, ['data.js', 'data.json', 'entry.json'])
}

internals.runAtomify = function runAtomify (config, callback) {
  atomify(config, callback)
}

internals.makeHTML = function makeHTML (paths, content, options) {
  // be sure to include the body tag so that the livereload snipped can
  // be inserted
  var html = '<head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">'
    + '<title>' + (options.title || path.basename(options.dir)) + '</title>'
    + '</head>'
    + '<body>'

  if (paths.css) html += '<link rel="stylesheet" href="' + paths.css + '" />'

  if (!options.isError) html += '<div id="app">' + content + '</div>'
  else html += content + '<div id="app"></div>'

  if (paths.js && options.enableClientJSX) html += '<script src="' + paths.js + '"></script>'
  html += '</body>'

  return html
}

internals.requireReactRouter = function requireReactRouter () {
  var ReactRouterPath = path.join(cwd, 'node_modules', 'react-router')
  Object.keys(require.cache).forEach(function removeReact (id) {
    if (id.indexOf(ReactRouterPath) > -1) delete require.cache[id]
  })
  return require(ReactRouterPath)
}

module.exports = function ribcagePreview (options, callback) {
  var config = {
      server: {
        lr: {
          port: 4001
        }
        , port: 4000
      }
    }
    , exampleDir = path.join(options.dir, 'example')
    , cssEntry = internals.findEntryCss(exampleDir)
    , jsEntry = internals.findEntryJs(exampleDir)
    , htmlEntry = internals.findEntryHTML(exampleDir)
    , jsComponent = internals.findEntryJs(options.dir)
    , dataEntry = internals.findEntryData(exampleDir)
    , enableReactRouter = options.enableReactRouter
    , enableJSX = jsEntry ? jsEntry.indexOf('.jsx') > -1 : false
    // React's context is … weird, and ReactRouter relies on it heavily. We
    // need to make sure we're requring the modules that the component is
    // using. Otherwise, the context goes missing
    , ReactPath = path.join(cwd, 'node_modules', 'react/')

  process.title = 'ribcage-preview'

  if (cssEntry) {
    config.css = {
      entry: cssEntry
      , alias: '/bundle.css'
      , debug: options.debug
      , autoprefixer: typeof options.autoprefix === 'undefined' ? true : options.autoprefix
    }
  }

  if (jsEntry) {
    config.js = {
      entry: jsEntry
      , alias: '/bundle.js'
      , debug: options.debug
      , extensions: ['.js', '.json', '.jsx']
    }
  }

  if (htmlEntry) {
    config.server.html = htmlEntry
  }

  if (enableJSX) {
    // setup the babel require hook, but only affect files in the cwd
    require('babel/register')({
      only: [new RegExp(cwd)]
      , sourceMap: 'inline'
      , ignore: [/node_modules/]
    })

    config.server.html = function defaultHtml (paths, htmlCallback) {
      var cacheId
      , React
      , ReactRouter
      , getHTML = function getHTML (reactComponent, data) {
        var done = function done (calcedReactComponent) {
          var content
            , htmlOptions = assign({}, options)

          try {
            content = React.renderToString(React.createElement(calcedReactComponent, data))
            if (React.documentHead) {
              assign(htmlOptions, React.documentHead)
              // clear now that we've grabbed the info we need
              React.documentHead = {}
            }
          }
          catch (e) {
            content = htmlifyError(e)
            htmlOptions.isError = true
          }

          htmlCallback(null, internals.makeHTML(
            paths
            , content
            , htmlOptions
          ))
        }

        if (enableReactRouter) ReactRouter.run(reactComponent, paths.request, done)
        else done(reactComponent)
      }
      , component

      console.info(chalk.blue('load: '), paths.request)

      // re-require react each time so that we get warning messages on each
      // page load
      Object.keys(require.cache).forEach(function removeReact (id) {
        if (id.indexOf(ReactPath) > -1) delete require.cache[id]
      })
      React = require(ReactPath)
      a11y(React)
      if (enableReactRouter) {
        ReactRouter = internals.requireReactRouter()
      }

      // remove the cached requires for anything in the cwd directory
      // we can't just remove the requires for the entries becuase they might
      // require something else, and we can't just look at options.dir because
      // it's nice to be able to change things outside of this component and
      // have the change picked up. It also more closely matches watchify
      // behavior
      for (cacheId in require.cache){
        if (cacheId.indexOf(cwd) > -1 && cacheId.indexOf('node_modules') < 0) {
          delete require.cache[cacheId]
        }
      }

      try {
        component = require(jsComponent)
        /* eslint-disable no-eq-null */
        // if we found what looks like a route component and the flag for react
        // router isn't passed, assume we actually want the router
        if (component && component.type && component.type.name === 'Route' && enableReactRouter == null) {
          /* eslint-enable no-eq-null */
          console.warn(chalk.yellow('→ Found a Route component, assuming you wanted to enable react-router. Pass --react-router=false to disable. Pass -r to disable this message.'))
          enableReactRouter = true
          ReactRouter = internals.requireReactRouter()
        }
        getHTML(component, dataEntry ? require(dataEntry) : null)
      }
      catch (err) {
        htmlCallback(err)
      }
    }
  }

  if (enableReactRouter){
    config.server.spaMode = true
  }

  internals.runAtomify(config, callback || function atomified (err) {
    if (err) console.error(chalk.red(err))
  })
}
