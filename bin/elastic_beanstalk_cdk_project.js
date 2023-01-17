#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const elastic_beanstalk_cdk_project_stack_1 = require("../lib/elastic_beanstalk_cdk_project-stack");
const app = new cdk.App();
const settings = app.node.tryGetContext('configuration');
new elastic_beanstalk_cdk_project_stack_1.ElasticBeanstalkCdkStack(app, 'ElasticBeanstalkCdkStack', settings);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWxhc3RpY19iZWFuc3RhbGtfY2RrX3Byb2plY3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlbGFzdGljX2JlYW5zdGFsa19jZGtfcHJvamVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBbUM7QUFDbkMsb0dBQXFIO0FBRXJILE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQzFCLE1BQU0sUUFBUSxHQUFrQyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsQ0FBQTtBQUV2RixJQUFJLDhEQUF3QixDQUFDLEdBQUcsRUFBRSwwQkFBMEIsRUFBRSxRQUFRLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBFbGFzdGljQmVhbnN0YWxrQ2RrU3RhY2ssIEVsYXN0aWNCZWFuc3RhbGtDZGtTdGFja1Byb3BzIH0gZnJvbSAnLi4vbGliL2VsYXN0aWNfYmVhbnN0YWxrX2Nka19wcm9qZWN0LXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbmNvbnN0IHNldHRpbmdzOiBFbGFzdGljQmVhbnN0YWxrQ2RrU3RhY2tQcm9wcyA9IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2NvbmZpZ3VyYXRpb24nKVxuXG5uZXcgRWxhc3RpY0JlYW5zdGFsa0Nka1N0YWNrKGFwcCwgJ0VsYXN0aWNCZWFuc3RhbGtDZGtTdGFjaycsIHNldHRpbmdzKTsiXX0=