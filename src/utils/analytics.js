import ua from 'universal-analytics';
import uuid from 'uuid/v4';
import { JSONStorage } from 'node-localstorage';
import appData from 'app-data-folder';

const nodeStorage = new JSONStorage(appData('greentunnel'));
const userId = nodeStorage.getItem('userid') || uuid();
nodeStorage.setItem('userid', userId);

var visitor = ua('UA-160385585-1', userId);

function appInit() {
  visitor.event("gt", "init").send()
}

export {appInit};
