import ua from 'universal-analytics';
import uuid from 'uuid/v4';
import { JSONStorage } from 'node-localstorage';
import appData from 'app-data-folder';
import os from 'os';
import packageJson from '../../package.json'
import isDocker from 'is-docker';

const nodeStorage = new JSONStorage(appData('greentunnel'));
const userId = nodeStorage.getItem('userid') || uuid();
nodeStorage.setItem('userid', userId);

var visitor = ua('UA-160385585-1', userId);

function appInit(source = 'OTHER') {
  const osPlatform = os.platform() + (isDocker() ? '-docker' : '')

  visitor.set('version', packageJson.version);
  visitor.set('os', osPlatform);
  visitor.set('source', source);

  visitor.event('gt-total', 'init').send();
  visitor.event(`gt-${source}`, 'init').send();
  visitor.event(`gt-${osPlatform}`, 'init').send();
  visitor.event(`gt-${packageJson.version}`, 'init').send();
}

export {appInit};
