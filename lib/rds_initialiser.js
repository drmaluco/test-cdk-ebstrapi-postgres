"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdkResourceInitializer = void 0;
const constructs_1 = require("constructs");
const ec2 = require("aws-cdk-lib/aws-ec2");
const lambda = require("aws-cdk-lib/aws-lambda");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const custom_resources_1 = require("aws-cdk-lib/custom-resources");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
/**
 * The main source for this code: https://aws.amazon.com/blogs/infrastructure-and-automation/use-aws-cdk-to-initialize-amazon-rds-instances/
 * My changes: Removed the function hash calculator when I moved to CDK v2. Getting function physical resource id by the function name instead.
 */
class CdkResourceInitializer extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const stack = aws_cdk_lib_1.Stack.of(this);
        const fnSg = new ec2.SecurityGroup(this, 'ResourceInitializerFnSg', {
            securityGroupName: `${id}ResourceInitializerFnSg`,
            vpc: props.vpc,
            allowAllOutbound: true
        });
        const fn = new lambda.DockerImageFunction(this, 'ResourceInitializerFn', {
            memorySize: props.fnMemorySize || 128,
            functionName: `${id}-ResInit${stack.stackName}`,
            code: props.fnCode,
            vpc: props.vpc,
            securityGroups: [fnSg, ...props.fnSecurityGroups],
            timeout: props.fnTimeout,
            logRetention: props.fnLogRetention,
            allowAllOutbound: true
        });
        const payload = JSON.stringify({
            params: {
                config: props.config
            }
        });
        const sdkCall = {
            service: 'Lambda',
            action: 'invoke',
            parameters: {
                FunctionName: fn.functionName,
                Payload: payload
            },
            physicalResourceId: custom_resources_1.PhysicalResourceId.of(fn.functionName)
        };
        const customResourceFnRole = new aws_iam_1.Role(this, 'AwsCustomResourceRoleInit', {
            assumedBy: new aws_iam_1.ServicePrincipal('lambda.amazonaws.com')
        });
        customResourceFnRole.addToPolicy(new aws_iam_1.PolicyStatement({
            resources: [`arn:aws:lambda:${stack.region}:${stack.account}:function:*-ResInit${stack.stackName}`],
            actions: ['lambda:InvokeFunction']
        }));
        this.customResource = new custom_resources_1.AwsCustomResource(this, 'AwsCustomResourceInit', {
            policy: custom_resources_1.AwsCustomResourcePolicy.fromSdkCalls({ resources: custom_resources_1.AwsCustomResourcePolicy.ANY_RESOURCE }),
            onUpdate: sdkCall,
            timeout: aws_cdk_lib_1.Duration.minutes(10),
            role: customResourceFnRole
        });
        this.response = this.customResource.getResponseField('Payload');
        this.function = fn;
    }
}
exports.CdkResourceInitializer = CdkResourceInitializer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmRzX2luaXRpYWxpc2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicmRzX2luaXRpYWxpc2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUF1QztBQUN2QywyQ0FBMEM7QUFDMUMsaURBQWdEO0FBQ2hELDZDQUE2QztBQUM3QyxtRUFBeUg7QUFFekgsaURBQTZFO0FBWTdFOzs7R0FHRztBQUVILE1BQWEsc0JBQXVCLFNBQVEsc0JBQVM7SUFLbkQsWUFBYSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQztRQUMzRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBRWhCLE1BQU0sS0FBSyxHQUFHLG1CQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTVCLE1BQU0sSUFBSSxHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDbEUsaUJBQWlCLEVBQUUsR0FBRyxFQUFFLHlCQUF5QjtZQUNqRCxHQUFHLEVBQUUsS0FBSyxDQUFDLEdBQUc7WUFDZCxnQkFBZ0IsRUFBRSxJQUFJO1NBQ3ZCLENBQUMsQ0FBQTtRQUVGLE1BQU0sRUFBRSxHQUFHLElBQUksTUFBTSxDQUFDLG1CQUFtQixDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUN2RSxVQUFVLEVBQUUsS0FBSyxDQUFDLFlBQVksSUFBSSxHQUFHO1lBQ3JDLFlBQVksRUFBRSxHQUFHLEVBQUUsV0FBVyxLQUFLLENBQUMsU0FBUyxFQUFFO1lBQy9DLElBQUksRUFBRSxLQUFLLENBQUMsTUFBTTtZQUNsQixHQUFHLEVBQUUsS0FBSyxDQUFDLEdBQUc7WUFDZCxjQUFjLEVBQUUsQ0FBQyxJQUFJLEVBQUUsR0FBRyxLQUFLLENBQUMsZ0JBQWdCLENBQUM7WUFDakQsT0FBTyxFQUFFLEtBQUssQ0FBQyxTQUFTO1lBQ3hCLFlBQVksRUFBRSxLQUFLLENBQUMsY0FBYztZQUNsQyxnQkFBZ0IsRUFBRSxJQUFJO1NBQ3ZCLENBQUMsQ0FBQTtRQUVGLE1BQU0sT0FBTyxHQUFXLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDckMsTUFBTSxFQUFFO2dCQUNOLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTthQUNyQjtTQUNGLENBQUMsQ0FBQTtRQUVGLE1BQU0sT0FBTyxHQUFlO1lBQzFCLE9BQU8sRUFBRSxRQUFRO1lBQ2pCLE1BQU0sRUFBRSxRQUFRO1lBQ2hCLFVBQVUsRUFBRTtnQkFDVixZQUFZLEVBQUUsRUFBRSxDQUFDLFlBQVk7Z0JBQzdCLE9BQU8sRUFBRSxPQUFPO2FBQ2pCO1lBQ0Qsa0JBQWtCLEVBQUUscUNBQWtCLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxZQUFZLENBQUM7U0FDM0QsQ0FBQTtRQUVELE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxjQUFJLENBQUMsSUFBSSxFQUFFLDJCQUEyQixFQUFFO1lBQ3ZFLFNBQVMsRUFBRSxJQUFJLDBCQUFnQixDQUFDLHNCQUFzQixDQUFDO1NBQ3hELENBQUMsQ0FBQTtRQUNGLG9CQUFvQixDQUFDLFdBQVcsQ0FDOUIsSUFBSSx5QkFBZSxDQUFDO1lBQ2xCLFNBQVMsRUFBRSxDQUFDLGtCQUFrQixLQUFLLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLHNCQUFzQixLQUFLLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDbkcsT0FBTyxFQUFFLENBQUMsdUJBQXVCLENBQUM7U0FDbkMsQ0FBQyxDQUNILENBQUE7UUFDRCxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksb0NBQWlCLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQ3pFLE1BQU0sRUFBRSwwQ0FBdUIsQ0FBQyxZQUFZLENBQUMsRUFBRSxTQUFTLEVBQUUsMENBQXVCLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDakcsUUFBUSxFQUFFLE9BQU87WUFDakIsT0FBTyxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUM3QixJQUFJLEVBQUUsb0JBQW9CO1NBQzNCLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUUvRCxJQUFJLENBQUMsUUFBUSxHQUFHLEVBQUUsQ0FBQTtJQUNwQixDQUFDO0NBQ0Y7QUEvREQsd0RBK0RDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMidcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJ1xuaW1wb3J0IHsgRHVyYXRpb24sIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInXG5pbXBvcnQgeyBBd3NDdXN0b21SZXNvdXJjZSwgQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3ksIEF3c1Nka0NhbGwsIFBoeXNpY2FsUmVzb3VyY2VJZCB9IGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnXG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnXG5pbXBvcnQgeyBQb2xpY3lTdGF0ZW1lbnQsIFJvbGUsIFNlcnZpY2VQcmluY2lwYWwgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJ1xuXG5leHBvcnQgaW50ZXJmYWNlIENka1Jlc291cmNlSW5pdGlhbGl6ZXJQcm9wcyB7XG4gIHZwYzogZWMyLklWcGNcbiAgZm5TZWN1cml0eUdyb3VwczogZWMyLklTZWN1cml0eUdyb3VwW11cbiAgZm5UaW1lb3V0OiBEdXJhdGlvblxuICBmbkNvZGU6IGxhbWJkYS5Eb2NrZXJJbWFnZUNvZGVcbiAgZm5Mb2dSZXRlbnRpb246IFJldGVudGlvbkRheXNcbiAgZm5NZW1vcnlTaXplPzogbnVtYmVyXG4gIGNvbmZpZzogYW55XG59XG5cbi8qKlxuICogVGhlIG1haW4gc291cmNlIGZvciB0aGlzIGNvZGU6IGh0dHBzOi8vYXdzLmFtYXpvbi5jb20vYmxvZ3MvaW5mcmFzdHJ1Y3R1cmUtYW5kLWF1dG9tYXRpb24vdXNlLWF3cy1jZGstdG8taW5pdGlhbGl6ZS1hbWF6b24tcmRzLWluc3RhbmNlcy9cbiAqIE15IGNoYW5nZXM6IFJlbW92ZWQgdGhlIGZ1bmN0aW9uIGhhc2ggY2FsY3VsYXRvciB3aGVuIEkgbW92ZWQgdG8gQ0RLIHYyLiBHZXR0aW5nIGZ1bmN0aW9uIHBoeXNpY2FsIHJlc291cmNlIGlkIGJ5IHRoZSBmdW5jdGlvbiBuYW1lIGluc3RlYWQuXG4gKi9cblxuZXhwb3J0IGNsYXNzIENka1Jlc291cmNlSW5pdGlhbGl6ZXIgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgcmVzcG9uc2U6IHN0cmluZ1xuICBwdWJsaWMgcmVhZG9ubHkgY3VzdG9tUmVzb3VyY2U6IEF3c0N1c3RvbVJlc291cmNlXG4gIHB1YmxpYyByZWFkb25seSBmdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uXG5cbiAgY29uc3RydWN0b3IgKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDZGtSZXNvdXJjZUluaXRpYWxpemVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpXG5cbiAgICBjb25zdCBzdGFjayA9IFN0YWNrLm9mKHRoaXMpXG5cbiAgICBjb25zdCBmblNnID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdSZXNvdXJjZUluaXRpYWxpemVyRm5TZycsIHtcbiAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiBgJHtpZH1SZXNvdXJjZUluaXRpYWxpemVyRm5TZ2AsXG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWVcbiAgICB9KVxuXG4gICAgY29uc3QgZm4gPSBuZXcgbGFtYmRhLkRvY2tlckltYWdlRnVuY3Rpb24odGhpcywgJ1Jlc291cmNlSW5pdGlhbGl6ZXJGbicsIHtcbiAgICAgIG1lbW9yeVNpemU6IHByb3BzLmZuTWVtb3J5U2l6ZSB8fCAxMjgsXG4gICAgICBmdW5jdGlvbk5hbWU6IGAke2lkfS1SZXNJbml0JHtzdGFjay5zdGFja05hbWV9YCxcbiAgICAgIGNvZGU6IHByb3BzLmZuQ29kZSxcbiAgICAgIHZwYzogcHJvcHMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtmblNnLCAuLi5wcm9wcy5mblNlY3VyaXR5R3JvdXBzXSxcbiAgICAgIHRpbWVvdXQ6IHByb3BzLmZuVGltZW91dCxcbiAgICAgIGxvZ1JldGVudGlvbjogcHJvcHMuZm5Mb2dSZXRlbnRpb24sXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlXG4gICAgfSlcblxuICAgIGNvbnN0IHBheWxvYWQ6IHN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIHBhcmFtczoge1xuICAgICAgICBjb25maWc6IHByb3BzLmNvbmZpZ1xuICAgICAgfVxuICAgIH0pXG5cbiAgICBjb25zdCBzZGtDYWxsOiBBd3NTZGtDYWxsID0ge1xuICAgICAgc2VydmljZTogJ0xhbWJkYScsXG4gICAgICBhY3Rpb246ICdpbnZva2UnLFxuICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICBGdW5jdGlvbk5hbWU6IGZuLmZ1bmN0aW9uTmFtZSxcbiAgICAgICAgUGF5bG9hZDogcGF5bG9hZFxuICAgICAgfSxcbiAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZDogUGh5c2ljYWxSZXNvdXJjZUlkLm9mKGZuLmZ1bmN0aW9uTmFtZSlcbiAgICB9XG4gIFxuICAgIGNvbnN0IGN1c3RvbVJlc291cmNlRm5Sb2xlID0gbmV3IFJvbGUodGhpcywgJ0F3c0N1c3RvbVJlc291cmNlUm9sZUluaXQnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpXG4gICAgfSlcbiAgICBjdXN0b21SZXNvdXJjZUZuUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsYW1iZGE6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZnVuY3Rpb246Ki1SZXNJbml0JHtzdGFjay5zdGFja05hbWV9YF0sXG4gICAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkludm9rZUZ1bmN0aW9uJ11cbiAgICAgIH0pXG4gICAgKVxuICAgIHRoaXMuY3VzdG9tUmVzb3VyY2UgPSBuZXcgQXdzQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0F3c0N1c3RvbVJlc291cmNlSW5pdCcsIHtcbiAgICAgIHBvbGljeTogQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuZnJvbVNka0NhbGxzKHsgcmVzb3VyY2VzOiBBd3NDdXN0b21SZXNvdXJjZVBvbGljeS5BTllfUkVTT1VSQ0UgfSksXG4gICAgICBvblVwZGF0ZTogc2RrQ2FsbCxcbiAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoMTApLFxuICAgICAgcm9sZTogY3VzdG9tUmVzb3VyY2VGblJvbGVcbiAgICB9KVxuXG4gICAgdGhpcy5yZXNwb25zZSA9IHRoaXMuY3VzdG9tUmVzb3VyY2UuZ2V0UmVzcG9uc2VGaWVsZCgnUGF5bG9hZCcpXG5cbiAgICB0aGlzLmZ1bmN0aW9uID0gZm5cbiAgfVxufSJdfQ==