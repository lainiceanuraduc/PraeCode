/**
 * Webview entry point.
 *
 * Everything the view needs lives in one module per concern (transcript, agents, attachments,
 * images, approvals, appearance) and `RadCodeView` composes them. Keeping this file to the bootstrap
 * makes it obvious where a change belongs.
 */
import {RadCodeView} from './RadCodeView';

new RadCodeView();
