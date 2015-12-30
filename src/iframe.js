export function create(src){
    var iframe = document.createElement('iframe');
    iframe.setAttribute('id', 'rethink');
    iframe.setAttribute('seamless', '');
    iframe.setAttribute('src', src);
    iframe.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin allow-popups');
    iframe.style.display = 'none';
    document.querySelector('body').appendChild(iframe);

    return iframe;
};
