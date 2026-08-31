(function() {
  const Router = {
    routes: {},
    guards: {},
    currentRoute: null,

    init: function(routes) {
      this.routes = routes || {};
      window.addEventListener('hashchange', this.handleHashChange.bind(this));
      this.handleHashChange();
    },

    navigate: function(routeName) {
      window.location.hash = '#/' + routeName;
    },

    current: function() {
      return this.currentRoute;
    },

    addGuard: function(routeName, guardFn) {
      this.guards[routeName] = guardFn;
    },

    getParams: function() {
      const hash = window.location.hash;
      if (!hash || !hash.startsWith('#/')) {
        return [];
      }
      const path = hash.substring(2);
      return path ? path.split('/').filter(p => p.length > 0) : [];
    },

    getRouteNameFromHash: function() {
      const params = this.getParams();
      if (params.length === 0) {
        return 'connect';
      }
      const routeName = params[0];
      return this.routes[routeName] ? routeName : 'connect';
    },

    getSubRoute: function() {
      const params = this.getParams();
      if (params.length <= 1) return '';
      return params.slice(1).join('/');
    },

    handleHashChange: function() {
      const targetRoute = this.getRouteNameFromHash();
      const subRoute = this.getSubRoute();
      const params = this.getParams();

      // Check guards first
      if (this.guards[targetRoute]) {
        const guardResult = this.guards[targetRoute]();
        if (typeof guardResult === 'string') {
          // Redirect
          this.navigate(guardResult);
          return;
        }
        if (guardResult === false) {
          // Guard failed, cancel navigation
          this.revertHash();
          return;
        }
      }

      const previousRoute = this.currentRoute;

      // Call route handler
      if (this.routes[targetRoute]) {
        const handlerResult = this.routes[targetRoute]();
        
        if (handlerResult === false) {
          // Handler cancelled navigation
          this.revertHash();
          return;
        }
      }

      this.currentRoute = targetRoute;

      // Emit custom event
      const event = new CustomEvent('routechange', {
        detail: {
          from: previousRoute,
          to: targetRoute,
          subRoute: subRoute,
          params: params
        }
      });
      document.dispatchEvent(event);
    },

    revertHash: function() {
      if (this.currentRoute) {
        window.location.hash = '#/' + this.currentRoute;
      } else {
        window.location.hash = '';
      }
    }
  };

  window.Router = Router;
})();
