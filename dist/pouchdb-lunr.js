'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _lunr = require('lunr');

var _lunr2 = _interopRequireDefault(_lunr);

var _lodash = require('lodash.debounce');

var _lodash2 = _interopRequireDefault(_lodash);

var _debug = require('debug');

var _debug2 = _interopRequireDefault(_debug);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function lunrIndexer(indexName, indexCreation, indexFunction) {
  var _this = this;

  var debug = (0, _debug2.default)('pouchdb:lunr:' + indexName);
  var ddocId = '_design/lunr_idx_' + indexName;
  debug('resolved ddoc id %s', ddocId);
  var createIndex = function createIndex(existingRev) {
    debug('starting to create index');
    var index = (0, _lunr2.default)(indexCreation);
    var indexBulk = function indexBulk(startKey) {
      return _this.allDocs({
        limit: 501,
        include_docs: true,
        startkey: startKey
      }).then(function (res) {
        res.rows.slice(0, 500).forEach(function (row) {
          return indexFunction(index, row.doc);
        });
        if (res.rows[500]) return indexBulk(res.rows[500].id);
        return _this.info().then(function (inf) {
          var idxDoc = {
            index: JSON.stringify(index.toJSON()),
            _id: ddocId,
            creationFunc: indexCreation.toString(),
            indexFunc: indexFunction.toString(),
            lastSeq: inf.update_seq
          };
          if (existingRev) idxDoc._rev = existingRev;
          return _this.put(idxDoc).then(function () {
            return _this.get(ddocId);
          });
        });
      });
    };
    return indexBulk();
  };
  if (this.lunrIndices[ddocId]) return Promise.resolve(this.lunrIndices[ddocId]);
  return this.get(ddocId).then(function (doc) {
    debug('existing index found');
    if (indexCreation && (doc.creationFunc !== indexCreation.toString() || doc.indexFunc !== indexFunction.toString())) return createIndex(doc._rev);
    return doc;
  }, function (err) {
    debug('No index found, neet to create new one');
    if (err.reason === 'missing') return createIndex();
    throw err;
  }).then(function (indexDoc) {
    var idx = _this.lunrIndices[indexDoc._id] || _lunr2.default.Index.load(JSON.parse(indexDoc.index)),
        indexFunction = strToFunc(indexDoc.indexFunc);

    _this.lunrIndices[indexDoc._id] = idx; // Make available runtime and ensure always same instance

    var updateDocSeq = (0, _lodash2.default)(function (seq) {
      debug('Updating last indexed seq to %s', seq);
      _this.get(indexDoc._id).then(function (d) {
        _this.put(Object.assign({}, d, {
          lastSeq: seq,
          index: JSON.stringify(idx.toJSON())
        }));
      });
    }, 10000);

    debug('starting to listen for changes, last indexed seq: %s', indexDoc.lastSeq);

    _this.changes({
      live: true,
      include_docs: true,
      since: indexDoc.lastSeq
    }).on('change', function (change) {
      debug('change triggered on seq %s', change.seq);
      if (change.id === indexDoc._id) return;
      if (change.deleted) {
        idx.remove({
          id: change.id
        });
      } else {
        indexFunction(idx, change.doc);
      }
      updateDocSeq(change.seq); // Wait 10 second for further updates
    });
    return idx;
  });
}

function lunrSearch(idxName, str) {
  var _this2 = this;

  return this.lunr(idxName).then(function (idx) {
    var refs = idx.search(str);
    return _this2.allDocs({
      keys: refs.map(function (r) {
        return r.ref;
      }),
      include_docs: true
    });
  });
}

exports.default = {
  lunr: lunrIndexer,
  lunrSearch: lunrSearch,
  lunrIndices: {}
};

function strToFunc(str) {
  return new Function('return ' + str)();
}
