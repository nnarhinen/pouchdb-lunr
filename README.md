# pouchdb-lunr
Some PouchDB sugar around [lunr.js](http://lunrjs.com/)

## Installation

```
npm install pouchdb pouchdb-lunr
```

## Usage

```js
import PouchDB from 'pouchdb';
import LunrPlugin from 'pouchdb-lunr';
PouchDB.plugin(LunrPlugin);

const db = new PouchDB('mydb');

db.lunr('fruits', function() {
  this.field('name');
}, function(idx, doc) {
  if (doc.type === 'fruit') {
    idx.add({
      id: doc._id,
      name: doc.name
    });
  }
});

db.lunrSearch('fruits', 'banana').then(function(res) {
  //res has same properties as db.allDocs()
});
```

## Author

Niklas Närhinen

## License

MIT License
