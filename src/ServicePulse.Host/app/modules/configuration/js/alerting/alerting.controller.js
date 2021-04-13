﻿(function (window, angular) {
    'use strict';

    function controller(
        $scope,
        alertingService,
        $http,
        notifyService,
        uri) {

        var vm = this;
        var notifier = notifyService();

        notifier.subscribe($scope, (event, response) => {
            vm.settings = response.alerting;
        }, 'AlertingConfigurationUpdated');

        function refreshData() {
            alertingService.getSettings().then((alerting) => {
                vm.settings = alerting.data;
            });
        }

        vm.settings = {};

        vm.sendTestEmail = () => {
            alert('send test email');
        };

        vm.toogleAlerting = () => {
            vm.settings.alerting_enabled = !vm.settings.alerting_enabled;
        };

        vm.save = () => {
            alertingService.updateAlertingSettings('test');
        };

        refreshData();
    }

    controller.$inject = [
        '$scope',
        'alertingService',
        '$http',
        'notifyService',
        'connectionsStatus',
        'uri',
    ];

    angular.module('configuration.alerting')
        .controller('alertingController', controller);

})(window, window.angular);