import ua from 'universal-analytics';
import uuid from 'uuid/v4';
import { JSONStorage } from 'node-localstorage';
import path from 'path';

import getPath from 'platform-folders';
const configFolder = path.join(getPath('appData'), 'greentunnel');
const nodeStorage = new JSONStorage(configFolder);
const userId = nodeStorage.getItem('userid') || uuid();
nodeStorage.setItem('userid', userId);

var visitor = ua('UA-160385585-1', userId);

function appInit() {
  visitor.event("gt", "init").send()
}

export {appInit};
