const { ipcRenderer } = require('electron');

$(document).ready(function() {

    $('#close-button').on('click', () => {
        ipcRenderer.send('close-button');
    });

    $('#on-off-button').on('click', () => {
        ipcRenderer.send('on-off-button');
    });

    ipcRenderer.on('changeStatus', (event, isOn) => {
        if (isOn) {
            $('.toggle').removeClass('off').addClass('on');
            $('#status-off-on').text('is on');
        } else {
            $('.toggle').removeClass('on').addClass('off');
            $('#status-off-on').text('is off');
        }
    });

});
