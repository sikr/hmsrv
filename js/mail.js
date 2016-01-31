(function() {

'use strict';

var mailer = require('nodemailer');
var smtp   = require('nodemailer-smtp-transport');
var log    = require('./logger.js');

var mail = {

  options: null,
  transport: null,

  init: function(options) {
    this.options = options;
    this.transport = mailer.createTransport(smtp({
      host: this.options.mail.host,
      port: this.options.mail.port,
      auth: {
          user: this.options.mail.user,
          pass: this.options.mail.password,
          secure: this.options.mail.secure
      }
    }));
  },
  send: function(subject, message, callback) {
    var mailOptions = {
        from: this.options.mail.user,
        to: this.options.mail.recipient,
        subject: subject,
        text: message
    };

    this.transport.sendMail(mailOptions, function(error, info) {
        if (error) {
          log.error('MAIL: ' + error);
        }
        else {
          log.info('MAIL: sent message to ' + this.options.mail.recipient + ': ' + info.response);
        }
        if (typeof callback === 'function') {
          callback();
        }
    });
  }

};

module.exports = mail;

})();
