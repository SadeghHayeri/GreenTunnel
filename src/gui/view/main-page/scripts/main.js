const { ipcRenderer } = require('electron');

$( document ).ready(function() {

    $('#close-button').on('click', () => {
        ipcRenderer.send('close-button')
    });

    $('#on-off-button').on('click', () => {
        ipcRenderer.send('on-off-button')
    });

    ipcRenderer.on('changeStatus', (event, isOn) => {
        if(isOn) {
            $('.toggle').each(() => {
                $(this).find('*').removeClass('red');
                $(this).find('*').addClass('green');
            });
            $('#status-off-on').html('is on');
        } else {
            $('.toggle').each(() => {
                $(this).find('*').removeClass('green');
                $(this).find('*').addClass('red');
            });
            $('#status-off-on').html('is off');
        }
    })

});


