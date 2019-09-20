/**
 * Copyright (c) Tiny Technologies, Inc. All rights reserved.
 * Licensed under the LGPL or a commercial license.
 * For LGPL see License.txt in the project root for license information.
 * For commercial licenses see https://www.tiny.cloud/
 */

import { Fun, Id } from '@ephox/katamari';

const reposition = Fun.constant(Id.generate('reposition'));
const toolbarHeightChange = Fun.constant(Id.generate('toolbar-height-change'));

export {
  reposition,
  toolbarHeightChange
};