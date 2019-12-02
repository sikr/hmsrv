var app = angular.module("hmsrvApp", ['ngRoute'])
  .config(function($routeProvider) {
    $routeProvider
    .when("/home", {
      templateUrl: 'views/home.html',
      controller: "homeCtrl"
    })
    .when("/data", {
      templateUrl: 'views/data.html',
      controller: "dataCtrl"
    })
    .when("/graphs", {
      templateUrl: 'views/graphs.html',
      controller: "graphsCtrl"
    })
    .when("/administration", {
      templateUrl: 'views/administration.html',
      controller: "administrationCtrl"
    });
  })
  .controller("homeCtrl", function($scope) {
    $scope.test = 'foobar';
  })
  .controller("dataCtrl", function($scope) {

  })
  .controller("graphsCtrl", function($scope) {

  })
  .controller("administrationCtrl", function($scope) {

  })
  .controller("projectName", function($scope, $http) {
    $http({
      method: 'GET',
      url: location.origin + '/stats'
    })
    .then(
      function (response){
        $scope.projectName = 'Hmsrv' + '@' + response.data.stats.hostname + ' - ' + response.data.stats.runMode.toLowerCase();
        $scope.class = 'navbar-' + response.data.stats.runMode.toLowerCase();
      },
      function (error){
      }
    );
  });

var socket = io.connect(location.origin);

socket.on('update', function (data) {
  console.log(data);
});
