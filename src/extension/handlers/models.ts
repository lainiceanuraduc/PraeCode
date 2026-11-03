/** Model handlers: the picker, favorites, per-model facts, provider form and effort catalog. */
import type {ExtensionHost} from '../host';
import type {ModelCommands} from '../commands/ModelCommands';
import type {HandlerTable} from './types';

export function modelHandlers(host: ExtensionHost, models: ModelCommands): HandlerTable {
  return {
    model: message => models.openPicker(typeof message.id === 'string' ? message.id : undefined),
    manualModel: message => models.pickManual(typeof message.id === 'string' ? message.id : undefined),
    useModel: (message, id) => {
      if (typeof message.value !== 'string') throw new Error('Choose a model first');
      return host.controller.setModel(id(), message.value);
    },
    favoritesRequest: () => models.postFavorites(),
    favorite: message => models.setFavorite(message),
    modelInfo: message => models.readInfo(message),
    modelFacts: () => models.readFacts(),
    providerSave: message => models.saveProvider(message),
    providerTest: message => models.testProvider(message),
    catalog: message => {
      if (typeof message.provider !== 'string' || typeof message.model !== 'string'
        || message.provider.length > 200 || message.model.length > 200) throw new Error('Invalid provider/model');
      const baseUrl = typeof message.baseUrl === 'string' && message.baseUrl.length <= 500 ? message.baseUrl : '';
      return host.controller.control.catalog(message.provider, message.model, baseUrl)
        .then(result => host.view.post({type: 'catalog', ...result, provider: message.provider, model: message.model}));
    }
  };
}
