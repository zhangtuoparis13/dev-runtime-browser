/**
* Copyright 2016 PT Inovação e Sistemas SA
* Copyright 2016 INESC-ID
* Copyright 2016 QUOBIS NETWORKS SL
* Copyright 2016 FRAUNHOFER-GESELLSCHAFT ZUR FOERDERUNG DER ANGEWANDTEN FORSCHUNG E.V
* Copyright 2016 ORANGE SA
* Copyright 2016 Deutsche Telekom AG
* Copyright 2016 Apizee
* Copyright 2016 TECHNISCHE UNIVERSITAT BERLIN
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/
export function create(src){
    var iframe = document.createElement('iframe');
    //iframe.setAttribute('id', 'rethink');
    //iframe.setAttribute('name', 'rethink');
    iframe.style.position = "fixed"
    iframe.style.top = "0"
    iframe.style.left = "0"
    iframe.style.right = "0"
    iframe.style.bottom = "0"
    iframe.style.border = "5px solid red"
    iframe.width = "100%"
    iframe.height = "100%"
    iframe.setAttribute('seamless', '');
    iframe.setAttribute('src', src);
    iframe.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin allow-popups');
    iframe.style.display = 'none';
    document.querySelector('body').appendChild(iframe);

    return iframe;
};
