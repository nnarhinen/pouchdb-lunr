'use strict';

import lunr from 'lunr';
import debounce from 'lodash.debounce';
import debugModule from 'debug';

function lunrIndexer(indexName, indexCreation, indexFunction) {
  const debug = debugModule(`pouchdb:lunr:${indexName}`);
  var ddocId = `_design/lunr_idx_${indexName}`;
  debug('resolved ddoc id %s', ddocId);
  let createIndex = (existingRev) => {
    debug('starting to create index');
    let index = lunr(indexCreation);
    let indexBulk = (startKey) => {
      return this.allDocs({
        limit: 501,
        include_docs: true,
        startkey: startKey
      }).then(res => {
        res.rows.slice(0, 500).forEach(row => indexFunction(index, row.doc));
        if (res.rows[500]) return indexBulk(res.rows[500].id);
        return this.info().then(inf => {
          var idxDoc = {
            index: JSON.stringify(index.toJSON()),
            _id: ddocId,
            creationFunc: indexCreation.toString(),
            indexFunc: indexFunction.toString(),
            lastSeq: inf.update_seq
          };
          if (existingRev) idxDoc._rev = existingRev;
          return this.put(idxDoc).then(() => this.get(ddocId));
        });
      });
    };
    return indexBulk();
  };
  if (this.lunrIndices[ddocId]) return Promise.resolve(this.lunrIndices[ddocId]);
  return this.get(ddocId).then(doc => {
    debug('existing index found');
    if (indexCreation && (doc.creationFunc !== indexCreation.toString() || doc.indexFunc !== indexFunction.toString())) return createIndex(doc._rev);
    return doc;
  }, err => {
    debug('No index found, neet to create new one');
    if (err.reason === 'missing') return createIndex();
    throw err;
  }).then(indexDoc => {
    let idx = this.lunrIndices[indexDoc._id] || lunr.Index.load(JSON.parse(indexDoc.index))
      , indexFunction = strToFunc(indexDoc.indexFunc);

    this.lunrIndices[indexDoc._id] = idx; // Make available runtime and ensure always same instance

    const updateDocSeq = debounce((seq) => {
      debug('Updating last indexed seq to %s', seq);
      this.get(indexDoc._id).then(d => {
        this.put(Object.assign({}, d, {
          lastSeq: seq,
          index: JSON.stringify(idx.toJSON())
        }));
      });
    }, 10000);

    debug('starting to listen for changes, last indexed seq: %s', indexDoc.lastSeq);

    this.changes({
      live: true,
      include_docs: true,
      since: indexDoc.lastSeq
    }).on('change', (change) => {
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
  return this.lunr(idxName).then(idx => {
    let refs = idx.search(str);
    return this.allDocs({
      keys: refs.map(r => r.ref),
      include_docs: true
    });
  });
}


export default {
  lunr: lunrIndexer,
  lunrSearch,
  lunrIndices: {}
};


function strToFunc(str) {
  return new Function('return ' + str)();
}
